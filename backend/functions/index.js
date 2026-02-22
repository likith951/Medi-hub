import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

/**
 * Scheduled function: runs every hour to expire stale access requests.
 * This is the production alternative to polling in the backend.
 */
export const expireAccessRequests = onSchedule('every 1 hours', async () => {
  const now = Timestamp.now();

  const snap = await db
    .collection('access_requests')
    .where('status', '==', 'approved')
    .where('isExpired', '==', false)
    .where('expiresAt', '<=', now)
    .get();

  if (snap.empty) {
    console.log('[expireAccessRequests] No stale requests found.');
    return;
  }

  const batch = db.batch();
  snap.docs.forEach((d) => {
    batch.update(d.ref, { status: 'expired', isExpired: true });
  });
  await batch.commit();

  console.log(`[expireAccessRequests] Expired ${snap.size} access requests.`);
});

/**
 * Trigger: when a new endorsement is created, recalculate the target doctor's accuracy score.
 */
export const onEndorsementCreated = onDocumentCreated(
  'endorsements/{endorsementId}',
  async (event) => {
    const endorsement = event.data?.data();
    if (!endorsement) return;

    const doctorRef = db.collection('doctors').doc(endorsement.targetDoctorId);
    const doctorDoc = await doctorRef.get();
    if (!doctorDoc.exists) return;

    const { endorsementCounts, stats } = doctorDoc.data();
    const totalEndorsements = Object.values(endorsementCounts || {}).reduce(
      (a, b) => a + b,
      0
    );
    const totalCases = stats?.totalCasesHandled || 1;
    const score = Math.min(100, Math.round((totalEndorsements / totalCases) * 50 + 50));

    await doctorRef.update({ 'stats.recordAccuracyScore': score });
    console.log(
      `[onEndorsementCreated] Updated accuracy score for doctor ${endorsement.targetDoctorId} to ${score}`
    );
  }
);

/**
 * Trigger: when a new access request is approved, update the doctor's response time stats.
 */
export const onAccessRequestResponded = onDocumentCreated(
  'access_requests/{requestId}',
  async (event) => {
    const request = event.data?.data();
    if (!request || request.status !== 'approved') return;

    const requestedAt = request.requestedAt?.toDate();
    const respondedAt = request.respondedAt?.toDate();

    if (!requestedAt || !respondedAt) return;

    const responseTimeHours =
      (respondedAt.getTime() - requestedAt.getTime()) / (1000 * 60 * 60);

    const doctorRef = db.collection('doctors').doc(request.doctorId);
    const doctorDoc = await doctorRef.get();
    if (!doctorDoc.exists) return;

    const { stats } = doctorDoc.data();
    const currentAvg = stats?.averageResponseTimeHours;
    const totalCases = stats?.totalCasesHandled || 1;

    const newAvg =
      currentAvg === null
        ? responseTimeHours
        : (currentAvg * (totalCases - 1) + responseTimeHours) / totalCases;

    await doctorRef.update({
      'stats.averageResponseTimeHours': parseFloat(newAvg.toFixed(2)),
    });
  }
);
