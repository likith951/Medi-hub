import { db, bucket, FieldValue, Timestamp, COLLECTIONS } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from '../services/activity.service.js';
import { updateDoctorStats } from '../services/doctor-stats.service.js';

/**
 * POST /api/records
 * Upload a new medical record (creates a "repository" entry with first "commit").
 * Only patients can call this.
 */
export const uploadRecord = async (req, res, next) => {
  try {
    const patientId = req.user.uid;
    const { title, recordType, description, tags, issuedBy, issuedDate, commitMessage } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'File is required.' });
    }

    const recordId = uuidv4();
    const versionId = uuidv4();
    const now = Timestamp.now();

    // Upload file to Firebase Storage
    const ext = file.originalname.split('.').pop();
    const storagePath = `records/${patientId}/${recordId}/v1_${versionId}.${ext}`;
    const fileRef = bucket.file(storagePath);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        metadata: {
          patientId,
          recordId,
          versionId,
          uploadedAt: now.toDate().toISOString(),
        },
      },
    });

    // Generate signed URL (24h) — in production use short-lived tokens
    const [signedUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });

    // Create the record document
    const record = {
      id: recordId,
      patientId,
      title,
      recordType,
      description: description || null,
      tags: tags || [],
      issuedBy: issuedBy || null,
      issuedDate: issuedDate || null,
      currentVersion: 1,
      currentVersionId: versionId,
      totalVersions: 1,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      createdBy: patientId, // could be a doctor with write access
    };

    // Create the version document (a "commit")
    const version = {
      id: versionId,
      recordId,
      patientId,
      versionNumber: 1,
      commitMessage,
      committedBy: patientId,
      committedByRole: 'patient',
      storagePath,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      changeType: 'initial_upload',
      diff: null, // For text records, could store diff
      createdAt: now,
    };

    // Commit log entry
    const commit = {
      id: uuidv4(),
      recordId,
      versionId,
      patientId,
      committedBy: patientId,
      committedByRole: 'patient',
      commitMessage,
      changeType: 'initial_upload',
      recordType,
      createdAt: now,
    };

    // Batch write
    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.RECORDS).doc(recordId), record);
    batch.set(
      db.collection(COLLECTIONS.RECORDS).doc(recordId)
        .collection(COLLECTIONS.RECORD_VERSIONS).doc(versionId),
      version
    );
    batch.set(db.collection(COLLECTIONS.COMMITS).doc(commit.id), commit);

    // Increment patient stats
    batch.update(db.collection(COLLECTIONS.PATIENTS).doc(patientId), {
      totalRecords: FieldValue.increment(1),
      totalVersions: FieldValue.increment(1),
      updatedAt: now,
    });

    await batch.commit();

    await logActivity({
      actorId: patientId,
      actorRole: 'patient',
      action: 'record_uploaded',
      resourceId: recordId,
      metadata: { recordType, title },
    });

    res.status(201).json({
      message: 'Record uploaded successfully.',
      record,
      version: { ...version, downloadUrl: signedUrl },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/records/:recordId/versions
 * Add a new version to an existing record (like a git commit).
 * Patient OR a doctor with write access can call this.
 */
export const addRecordVersion = async (req, res, next) => {
  try {
    const callerId = req.user.uid;
    const callerRole = req.user.role;
    const { recordId } = req.params;
    const { commitMessage } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'File is required.' });

    // Fetch the record
    const recordRef = db.collection(COLLECTIONS.RECORDS).doc(recordId);
    const recordDoc = await recordRef.get();
    if (!recordDoc.exists) return res.status(404).json({ error: 'Record not found.' });

    const record = recordDoc.data();

    // Access check
    if (callerRole === 'patient' && record.patientId !== callerId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (callerRole === 'doctor') {
      await assertDoctorWriteAccess(callerId, record.patientId);
    }

    const versionId = uuidv4();
    const newVersionNumber = record.currentVersion + 1;
    const now = Timestamp.now();
    const ext = file.originalname.split('.').pop();
    const storagePath = `records/${record.patientId}/${recordId}/v${newVersionNumber}_${versionId}.${ext}`;
    const fileRef = bucket.file(storagePath);

    await fileRef.save(file.buffer, {
      metadata: { contentType: file.mimetype },
    });

    const [signedUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000,
    });

    const version = {
      id: versionId,
      recordId,
      patientId: record.patientId,
      versionNumber: newVersionNumber,
      commitMessage,
      committedBy: callerId,
      committedByRole: callerRole,
      storagePath,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      changeType: 'update',
      createdAt: now,
    };

    const commit = {
      id: uuidv4(),
      recordId,
      versionId,
      patientId: record.patientId,
      committedBy: callerId,
      committedByRole: callerRole,
      commitMessage,
      changeType: 'update',
      recordType: record.recordType,
      createdAt: now,
    };

    const batch = db.batch();
    batch.update(recordRef, {
      currentVersion: newVersionNumber,
      currentVersionId: versionId,
      totalVersions: FieldValue.increment(1),
      updatedAt: now,
    });
    batch.set(
      recordRef.collection(COLLECTIONS.RECORD_VERSIONS).doc(versionId),
      version
    );
    batch.set(db.collection(COLLECTIONS.COMMITS).doc(commit.id), commit);
    batch.update(db.collection(COLLECTIONS.PATIENTS).doc(record.patientId), {
      totalVersions: FieldValue.increment(1),
      updatedAt: now,
    });
    await batch.commit();

    // Update doctor contribution graph if doctor made the commit
    if (callerRole === 'doctor') {
      await updateDoctorStats(callerId, { recordUpdated: true, patientId: record.patientId });
    }

    await logActivity({
      actorId: callerId,
      actorRole: callerRole,
      action: 'record_version_added',
      resourceId: recordId,
      metadata: { versionNumber: newVersionNumber, commitMessage },
    });

    res.status(201).json({
      message: `Version ${newVersionNumber} committed.`,
      version: { ...version, downloadUrl: signedUrl },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/records/:recordId/versions
 * Returns the full version history of a record (the "git log").
 */
export const getRecordVersions = async (req, res, next) => {
  try {
    const callerId = req.user.uid;
    const callerRole = req.user.role;
    const { recordId } = req.params;

    const recordDoc = await db.collection(COLLECTIONS.RECORDS).doc(recordId).get();
    if (!recordDoc.exists) return res.status(404).json({ error: 'Record not found.' });

    const record = recordDoc.data();

    if (callerRole === 'patient' && record.patientId !== callerId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (callerRole === 'doctor') {
      await assertDoctorReadAccess(callerId, record.patientId, record.recordType);
    }

    const versionsSnap = await db
      .collection(COLLECTIONS.RECORDS).doc(recordId)
      .collection(COLLECTIONS.RECORD_VERSIONS)
      .orderBy('versionNumber', 'desc')
      .get();

    const versions = versionsSnap.docs.map((d) => d.data());

    res.json({ record, versions, totalVersions: versions.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/records/:recordId/versions/:versionId/download
 * Get a signed download URL for a specific version.
 */
export const getVersionDownloadUrl = async (req, res, next) => {
  try {
    const callerId = req.user.uid;
    const callerRole = req.user.role;
    const { recordId, versionId } = req.params;

    const recordDoc = await db.collection(COLLECTIONS.RECORDS).doc(recordId).get();
    if (!recordDoc.exists) return res.status(404).json({ error: 'Record not found.' });
    const record = recordDoc.data();

    if (callerRole === 'patient' && record.patientId !== callerId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (callerRole === 'doctor') {
      await assertDoctorReadAccess(callerId, record.patientId, record.recordType);
    }

    const versionDoc = await db
      .collection(COLLECTIONS.RECORDS).doc(recordId)
      .collection(COLLECTIONS.RECORD_VERSIONS).doc(versionId)
      .get();

    if (!versionDoc.exists) return res.status(404).json({ error: 'Version not found.' });
    const version = versionDoc.data();

    const fileRef = bucket.file(version.storagePath);
    const [signedUrl] = await fileRef.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    res.json({ downloadUrl: signedUrl, version });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/patients/:patientId/records
 * List all records for a patient.
 */
export const getPatientRecords = async (req, res, next) => {
  try {
    const callerId = req.user.uid;
    const callerRole = req.user.role;
    const { patientId } = req.params;

    if (callerRole === 'patient' && patientId !== callerId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (callerRole === 'doctor') {
      await assertDoctorReadAccess(callerId, patientId, 'all');
    }

    const snap = await db
      .collection(COLLECTIONS.RECORDS)
      .where('patientId', '==', patientId)
      .where('isArchived', '==', false)
      .orderBy('updatedAt', 'desc')
      .get();

    const records = snap.docs.map((d) => d.data());
    res.json({ records, total: records.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/patients/:patientId/commits
 * Full commit log for a patient's repository.
 */
export const getPatientCommitLog = async (req, res, next) => {
  try {
    const callerId = req.user.uid;
    const callerRole = req.user.role;
    const { patientId } = req.params;

    if (callerRole === 'patient' && patientId !== callerId) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    if (callerRole === 'doctor') {
      await assertDoctorReadAccess(callerId, patientId, 'all');
    }

    const snap = await db
      .collection(COLLECTIONS.COMMITS)
      .where('patientId', '==', patientId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const commits = snap.docs.map((d) => d.data());
    res.json({ commits, total: commits.length });
  } catch (err) {
    next(err);
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const assertDoctorReadAccess = async (doctorId, patientId, recordType) => {
  const snap = await db
    .collection(COLLECTIONS.ACCESS_REQUESTS)
    .where('doctorId', '==', doctorId)
    .where('patientId', '==', patientId)
    .where('status', '==', 'approved')
    .where('isExpired', '==', false)
    .limit(1)
    .get();

  if (snap.empty) {
    const err = new Error('You do not have approved access to this patient\'s records.');
    err.status = 403;
    throw err;
  }

  const access = snap.docs[0].data();
  if (recordType !== 'all' &&
    !access.requestedRecordTypes.includes('all') &&
    !access.requestedRecordTypes.includes(recordType)) {
    const err = new Error(`You do not have access to record type: ${recordType}`);
    err.status = 403;
    throw err;
  }
};

const assertDoctorWriteAccess = async (doctorId, patientId) => {
  const snap = await db
    .collection(COLLECTIONS.ACCESS_REQUESTS)
    .where('doctorId', '==', doctorId)
    .where('patientId', '==', patientId)
    .where('status', '==', 'approved')
    .where('accessLevel', '==', 'read_write')
    .where('isExpired', '==', false)
    .limit(1)
    .get();

  if (snap.empty) {
    const err = new Error('You do not have write access to this patient\'s records.');
    err.status = 403;
    throw err;
  }
};
