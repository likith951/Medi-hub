import { db, FieldValue, Timestamp, COLLECTIONS } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from '../services/activity.service.js';
import { updateDoctorStats } from '../services/doctor-stats.service.js';
import { createNotification } from '../services/notification.service.js';

/**
 * POST /api/access-requests
 * Doctor sends a "pull request" to access a patient's records.
 */
export const createAccessRequest = async (req, res, next) => {
  try {
    const doctorId = req.user.uid;
    const { patientId, reason, accessLevel, requestedRecordTypes, expiryDays } = req.body;

    // Verify patient exists
    const patientDoc = await db.collection(COLLECTIONS.PATIENTS).doc(patientId).get();
    if (!patientDoc.exists) return res.status(404).json({ error: 'Patient not found.' });

    // Check no pending/approved request already exists
    const existingSnap = await db
      .collection(COLLECTIONS.ACCESS_REQUESTS)
      .where('doctorId', '==', doctorId)
      .where('patientId', '==', patientId)
      .where('status', 'in', ['pending', 'approved'])
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return res.status(409).json({
        error: 'An active or pending access request already exists for this patient.',
        existingRequestId: existingSnap.docs[0].id,
      });
    }

    const requestId = uuidv4();
    const now = Timestamp.now();

    const accessRequest = {
      id: requestId,
      doctorId,
      doctorName: req.user.displayName,
      patientId,
      reason,
      accessLevel: accessLevel || 'read',
      requestedRecordTypes,
      expiryDays: expiryDays || 30,
      status: 'pending', // pending | approved | denied | revoked | expired
      isExpired: false,
      requestedAt: now,
      respondedAt: null,
      expiresAt: null, // set on approval
      note: null,
    };

    await db.collection(COLLECTIONS.ACCESS_REQUESTS).doc(requestId).set(accessRequest);

    // Notify the patient
    await createNotification({
      recipientId: patientId,
      type: 'access_request',
      title: 'New Access Request',
      body: `Dr. ${req.user.displayName} is requesting access to your medical records.`,
      metadata: { requestId, doctorId },
    });

    await logActivity({
      actorId: doctorId,
      actorRole: 'doctor',
      action: 'access_request_created',
      resourceId: requestId,
      metadata: { patientId, accessLevel },
    });

    res.status(201).json({
      message: 'Access request sent to patient.',
      request: accessRequest,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/access-requests/:requestId/respond
 * Patient approves or denies a doctor's access request.
 */
export const respondToAccessRequest = async (req, res, next) => {
  try {
    const patientId = req.user.uid;
    const { requestId } = req.params;
    const { approved, note } = req.body;

    const requestRef = db.collection(COLLECTIONS.ACCESS_REQUESTS).doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) return res.status(404).json({ error: 'Request not found.' });

    const request = requestDoc.data();

    if (request.patientId !== patientId) {
      return res.status(403).json({ error: 'This request is not addressed to you.' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `Request is already ${request.status}.` });
    }

    const now = Timestamp.now();
    const newStatus = approved ? 'approved' : 'denied';

    const update = {
      status: newStatus,
      respondedAt: now,
      note: note || null,
    };

    if (approved) {
      const expiresAt = Timestamp.fromDate(
        new Date(Date.now() + request.expiryDays * 24 * 60 * 60 * 1000)
      );
      update.expiresAt = expiresAt;

      // Update doctor's stats
      await updateDoctorStats(request.doctorId, { newCase: true, patientId });

      // Update patient's collaborator count
      await db.collection(COLLECTIONS.PATIENTS).doc(patientId).update({
        activeCollaborators: FieldValue.increment(1),
        updatedAt: now,
      });
    }

    await requestRef.update(update);

    // Notify doctor
    await createNotification({
      recipientId: request.doctorId,
      type: 'access_request_response',
      title: approved ? 'Access Request Approved' : 'Access Request Denied',
      body: approved
        ? `Your request to access ${req.user.displayName}'s records was approved.`
        : `Your request to access a patient's records was denied.`,
      metadata: { requestId, patientId },
    });

    await logActivity({
      actorId: patientId,
      actorRole: 'patient',
      action: approved ? 'access_request_approved' : 'access_request_denied',
      resourceId: requestId,
      metadata: { doctorId: request.doctorId },
    });

    res.json({
      message: `Access request ${newStatus}.`,
      request: { ...request, ...update },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/access-requests/:requestId/revoke
 * Patient can revoke previously approved access.
 */
export const revokeAccess = async (req, res, next) => {
  try {
    const patientId = req.user.uid;
    const { requestId } = req.params;

    const requestRef = db.collection(COLLECTIONS.ACCESS_REQUESTS).doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) return res.status(404).json({ error: 'Request not found.' });
    const request = requestDoc.data();

    if (request.patientId !== patientId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (request.status !== 'approved') {
      return res.status(409).json({ error: 'Only approved access can be revoked.' });
    }

    const now = Timestamp.now();
    await requestRef.update({ status: 'revoked', revokedAt: now, isExpired: true });

    await db.collection(COLLECTIONS.PATIENTS).doc(patientId).update({
      activeCollaborators: FieldValue.increment(-1),
      updatedAt: now,
    });

    await createNotification({
      recipientId: request.doctorId,
      type: 'access_revoked',
      title: 'Access Revoked',
      body: 'A patient has revoked your access to their medical records.',
      metadata: { requestId },
    });

    res.json({ message: 'Access revoked successfully.' });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/access-requests/incoming
 * Patient sees all incoming requests.
 */
export const getIncomingRequests = async (req, res, next) => {
  try {
    const patientId = req.user.uid;
    const { status } = req.query;

    let query = db
      .collection(COLLECTIONS.ACCESS_REQUESTS)
      .where('patientId', '==', patientId)
      .orderBy('requestedAt', 'desc');

    if (status) query = query.where('status', '==', status);

    const snap = await query.limit(50).get();
    const requests = snap.docs.map((d) => d.data());

    res.json({ requests, total: requests.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/access-requests/outgoing
 * Doctor sees all their sent requests.
 */
export const getOutgoingRequests = async (req, res, next) => {
  try {
    const doctorId = req.user.uid;

    const snap = await db
      .collection(COLLECTIONS.ACCESS_REQUESTS)
      .where('doctorId', '==', doctorId)
      .orderBy('requestedAt', 'desc')
      .limit(50)
      .get();

    const requests = snap.docs.map((d) => d.data());
    res.json({ requests, total: requests.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/patients/:patientId/collaborators
 * Returns all doctors currently with approved access to a patient.
 */
export const getPatientCollaborators = async (req, res, next) => {
  try {
    const callerId = req.user.uid;
    const { patientId } = req.params;

    if (req.user.role === 'patient' && callerId !== patientId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const snap = await db
      .collection(COLLECTIONS.ACCESS_REQUESTS)
      .where('patientId', '==', patientId)
      .where('status', '==', 'approved')
      .where('isExpired', '==', false)
      .get();

    const collaborators = await Promise.all(
      snap.docs.map(async (d) => {
        const req = d.data();
        const doctorDoc = await db.collection(COLLECTIONS.DOCTORS).doc(req.doctorId).get();
        return {
          accessRequest: req,
          doctor: doctorDoc.exists ? doctorDoc.data() : null,
        };
      })
    );

    res.json({ collaborators, total: collaborators.length });
  } catch (err) {
    next(err);
  }
};
