import { db, FieldValue, Timestamp, COLLECTIONS } from '../config/firebase.js';

/**
 * Update a doctor's contribution stats and graph.
 *
 * @param {string} doctorId
 * @param {Object} options
 * @param {boolean} [options.newCase]        - Doctor was approved for a new patient case
 * @param {boolean} [options.caseCompleted]  - Doctor marked a case as complete
 * @param {boolean} [options.recordUpdated]  - Doctor committed a record update
 * @param {string}  [options.patientId]      - Related patient (for condition tag extraction)
 * @param {string[]} [options.conditionTags] - New condition tags derived from the case
 * @param {number}  [options.responseTimeHours] - Response time for this interaction
 */
export const updateDoctorStats = async (doctorId, options = {}) => {
  try {
    const docRef = db.collection(COLLECTIONS.DOCTORS).doc(doctorId);
    const now = Timestamp.now();
    const todayKey = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

    const updates = {
      updatedAt: now,
      'stats.lastActiveAt': now,
      // Increment today's contribution graph entry
      [`contributionGraph.${todayKey}`]: FieldValue.increment(1),
    };

    if (options.newCase) {
      updates['stats.totalCasesHandled'] = FieldValue.increment(1);
      updates['stats.activeCases'] = FieldValue.increment(1);
    }

    if (options.caseCompleted) {
      updates['stats.activeCases'] = FieldValue.increment(-1);
    }

    if (options.recordUpdated) {
      updates['stats.totalRecordsUpdated'] = FieldValue.increment(1);
    }

    if (options.responseTimeHours !== undefined) {
      // Update rolling average response time
      const doctorDoc = await docRef.get();
      const currentAvg = doctorDoc.data()?.stats?.averageResponseTimeHours;
      const totalCases = doctorDoc.data()?.stats?.totalCasesHandled || 1;

      if (currentAvg === null) {
        updates['stats.averageResponseTimeHours'] = options.responseTimeHours;
      } else {
        // Rolling average
        const newAvg = (currentAvg * (totalCases - 1) + options.responseTimeHours) / totalCases;
        updates['stats.averageResponseTimeHours'] = parseFloat(newAvg.toFixed(2));
      }
    }

    if (options.conditionTags?.length) {
      updates['conditionTags'] = FieldValue.arrayUnion(...options.conditionTags);
    }

    await docRef.update(updates);
  } catch (err) {
    console.error('updateDoctorStats failed:', err.message);
  }
};

/**
 * Recalculate a doctor's record accuracy score.
 * Called when an endorsement is added or a peer flags an inaccuracy.
 * Score = (positive endorsements / total interactions) * 100
 */
export const recalculateDoctorAccuracyScore = async (doctorId) => {
  try {
    const doctorDoc = await db.collection(COLLECTIONS.DOCTORS).doc(doctorId).get();
    if (!doctorDoc.exists) return;

    const { endorsementCounts, stats } = doctorDoc.data();
    const totalEndorsements = Object.values(endorsementCounts || {}).reduce((a, b) => a + b, 0);
    const totalCases = stats?.totalCasesHandled || 0;

    if (totalCases === 0) return;

    // Simple heuristic — can be made more sophisticated
    const score = Math.min(100, Math.round((totalEndorsements / totalCases) * 50 + 50));

    await db.collection(COLLECTIONS.DOCTORS).doc(doctorId).update({
      'stats.recordAccuracyScore': score,
    });
  } catch (err) {
    console.error('recalculateDoctorAccuracyScore failed:', err.message);
  }
};

/**
 * Scheduled job helper: expire access requests that are past their expiresAt date.
 * Call this from a Cloud Function cron job or a scheduled script.
 */
export const expireStaleAccessRequests = async () => {
  try {
    const now = Timestamp.now();
    const snap = await db
      .collection(COLLECTIONS.ACCESS_REQUESTS)
      .where('status', '==', 'approved')
      .where('isExpired', '==', false)
      .where('expiresAt', '<=', now)
      .get();

    if (snap.empty) {
      console.log('No stale access requests to expire.');
      return;
    }

    const batch = db.batch();
    snap.docs.forEach((d) => {
      batch.update(d.ref, { status: 'expired', isExpired: true });
    });
    await batch.commit();

    console.log(`Expired ${snap.size} access requests.`);
  } catch (err) {
    console.error('expireStaleAccessRequests failed:', err.message);
  }
};
