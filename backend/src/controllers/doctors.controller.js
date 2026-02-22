import { db, COLLECTIONS } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';
import { Timestamp, FieldValue } from '../config/firebase.js';

/**
 * GET /api/doctors
 * Discover doctors — sorted purely by contribution data, not ratings or ads.
 * Supports filters: specialization, conditionTag, minCases, sortBy
 */
export const discoverDoctors = async (req, res, next) => {
  try {
    const {
      specialization,
      conditionTag,
      minCases,
      sortBy = 'totalCasesHandled', // totalCasesHandled | recordAccuracyScore | averageResponseTimeHours
      limit: limitParam = '20',
      page = '1',
    } = req.query;

    const pageLimit = Math.min(parseInt(limitParam, 10), 50);
    const offset = (parseInt(page, 10) - 1) * pageLimit;

    let query = db
      .collection(COLLECTIONS.DOCTORS)
      .where('isVerified', '==', true);

    if (specialization) {
      query = query.where('specialization', '==', specialization);
    }

    if (conditionTag) {
      query = query.where('conditionTags', 'array-contains', conditionTag);
    }

    // Fetch and sort in memory (Firestore doesn't support multi-field inequality in one query)
    const snap = await query.get();
    let doctors = snap.docs.map((d) => {
      const data = d.data();
      // Exclude sensitive fields from discovery
      const { licenseNumber, phone, ...publicData } = data;
      return publicData;
    });

    if (minCases) {
      doctors = doctors.filter((d) => d.stats.totalCasesHandled >= parseInt(minCases, 10));
    }

    // Sort by the requested contribution metric
    doctors.sort((a, b) => {
      if (sortBy === 'averageResponseTimeHours') {
        // Lower is better for response time
        const aVal = a.stats.averageResponseTimeHours ?? Infinity;
        const bVal = b.stats.averageResponseTimeHours ?? Infinity;
        return aVal - bVal;
      }
      const aVal = a.stats[sortBy] ?? 0;
      const bVal = b.stats[sortBy] ?? 0;
      return bVal - aVal;
    });

    const total = doctors.length;
    const paginated = doctors.slice(offset, offset + pageLimit);

    res.json({
      doctors: paginated,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: pageLimit,
        totalPages: Math.ceil(total / pageLimit),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/doctors/:doctorId
 * Get a doctor's full public "GitHub profile" — all contribution data, no ratings.
 */
export const getDoctorProfile = async (req, res, next) => {
  try {
    const { doctorId } = req.params;

    const doctorDoc = await db.collection(COLLECTIONS.DOCTORS).doc(doctorId).get();
    if (!doctorDoc.exists) return res.status(404).json({ error: 'Doctor not found.' });

    const doctor = doctorDoc.data();

    // Fetch endorsements
    const endorsementsSnap = await db
      .collection(COLLECTIONS.ENDORSEMENTS)
      .where('targetDoctorId', '==', doctorId)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const endorsements = endorsementsSnap.docs.map((d) => {
      const e = d.data();
      // Show endorser name but not their personal details
      return {
        id: e.id,
        skill: e.skill,
        note: e.note,
        endorserName: e.endorserName,
        createdAt: e.createdAt,
      };
    });

    // Strip sensitive data
    const { licenseNumber, phone, ...publicProfile } = doctor;

    res.json({
      doctor: publicProfile,
      endorsements,
      contributionGraph: doctor.contributionGraph,
      conditionTags: doctor.conditionTags,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/doctors/:doctorId/contribution-graph
 * Returns the 365-day contribution graph for a doctor (like GitHub's green squares).
 */
export const getDoctorContributionGraph = async (req, res, next) => {
  try {
    const { doctorId } = req.params;

    const doctorDoc = await db.collection(COLLECTIONS.DOCTORS).doc(doctorId).get();
    if (!doctorDoc.exists) return res.status(404).json({ error: 'Doctor not found.' });

    const { contributionGraph, stats } = doctorDoc.data();

    // Calculate streak and total
    const today = new Date();
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let totalContributions = 0;

    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      const count = contributionGraph[key] || 0;
      totalContributions += count;

      if (count > 0) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
        if (i === 0 || i === 1) currentStreak = tempStreak;
      } else {
        if (i > 1) tempStreak = 0;
      }
    }

    res.json({
      doctorId,
      contributionGraph,
      summary: {
        totalContributions,
        currentStreak,
        longestStreak,
        activeCases: stats.activeCases,
        totalCasesHandled: stats.totalCasesHandled,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/doctors/:doctorId/endorse
 * A verified doctor can endorse another doctor for a specific skill.
 * (No patient reviews — only peer endorsements from verified doctors.)
 */
export const endorseDoctor = async (req, res, next) => {
  try {
    const endorserId = req.user.uid;
    const { doctorId: targetDoctorId } = req.params;
    const { skill, note } = req.body;

    if (endorserId === targetDoctorId) {
      return res.status(400).json({ error: 'You cannot endorse yourself.' });
    }

    // Check target doctor exists and is verified
    const targetDoc = await db.collection(COLLECTIONS.DOCTORS).doc(targetDoctorId).get();
    if (!targetDoc.exists) return res.status(404).json({ error: 'Doctor not found.' });
    if (!targetDoc.data().isVerified) {
      return res.status(400).json({ error: 'Cannot endorse an unverified doctor.' });
    }

    // Check if endorser already endorsed this skill for this doctor
    const existingSnap = await db
      .collection(COLLECTIONS.ENDORSEMENTS)
      .where('endorserId', '==', endorserId)
      .where('targetDoctorId', '==', targetDoctorId)
      .where('skill', '==', skill)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return res.status(409).json({ error: 'You have already endorsed this doctor for this skill.' });
    }

    const endorsementId = uuidv4();
    const now = Timestamp.now();

    const endorsement = {
      id: endorsementId,
      endorserId,
      endorserName: req.user.displayName,
      targetDoctorId,
      skill,
      note: note || null,
      createdAt: now,
    };

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.ENDORSEMENTS).doc(endorsementId), endorsement);

    // Increment the endorsement count on the doctor's profile
    batch.update(db.collection(COLLECTIONS.DOCTORS).doc(targetDoctorId), {
      [`endorsementCounts.${skill}`]: FieldValue.increment(1),
      updatedAt: now,
    });

    await batch.commit();

    res.status(201).json({ message: 'Endorsement added.', endorsement });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/specializations
 * Returns list of all unique specializations from verified doctors (for filter UI).
 */
export const getSpecializations = async (req, res, next) => {
  try {
    const snap = await db
      .collection(COLLECTIONS.DOCTORS)
      .where('isVerified', '==', true)
      .select('specialization', 'conditionTags')
      .get();

    const specializationsSet = new Set();
    const tagsSet = new Set();

    snap.docs.forEach((d) => {
      const { specialization, conditionTags } = d.data();
      if (specialization) specializationsSet.add(specialization);
      (conditionTags || []).forEach((t) => tagsSet.add(t));
    });

    res.json({
      specializations: Array.from(specializationsSet).sort(),
      conditionTags: Array.from(tagsSet).sort(),
    });
  } catch (err) {
    next(err);
  }
};
