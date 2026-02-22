import { db, auth, FieldValue, Timestamp, COLLECTIONS } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * POST /api/auth/register/patient
 * Called after Firebase client-side sign-up.
 * Creates Firestore user profile for a patient.
 */
export const registerPatient = async (req, res, next) => {
  try {
    const uid = req.user.uid;

    // Prevent double registration
    const existing = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    if (existing.exists) {
      return res.status(409).json({ error: 'Profile already exists.' });
    }

    const { displayName, dateOfBirth, gender, bloodGroup, phone, emergencyContact } = req.body;

    const now = Timestamp.now();

    const userProfile = {
      uid,
      email: req.user.email,
      role: 'patient',
      displayName,
      phone: phone || null,
      createdAt: now,
      updatedAt: now,
    };

    const patientProfile = {
      uid,
      displayName,
      dateOfBirth,
      gender,
      bloodGroup: bloodGroup || null,
      phone: phone || null,
      emergencyContact: emergencyContact || null,
      // "Repository" metadata
      totalRecords: 0,
      totalVersions: 0,
      activeCollaborators: 0,
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.USERS).doc(uid), userProfile);
    batch.set(db.collection(COLLECTIONS.PATIENTS).doc(uid), patientProfile);
    await batch.commit();

    res.status(201).json({
      message: 'Patient profile created successfully.',
      user: userProfile,
      patient: patientProfile,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/register/doctor
 * Creates Firestore profile for a doctor (pending verification).
 */
export const registerDoctor = async (req, res, next) => {
  try {
    const uid = req.user.uid;

    const existing = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    if (existing.exists) {
      return res.status(409).json({ error: 'Profile already exists.' });
    }

    const {
      displayName,
      specialization,
      qualifications,
      licenseNumber,
      hospitalAffiliations,
      phone,
      yearsOfExperience,
    } = req.body;

    const now = Timestamp.now();

    const userProfile = {
      uid,
      email: req.user.email,
      role: 'doctor',
      displayName,
      phone: phone || null,
      isVerified: false, // admin must verify
      createdAt: now,
      updatedAt: now,
    };

    // GitHub-style contribution stats
    const doctorProfile = {
      uid,
      displayName,
      specialization,
      qualifications,
      licenseNumber,
      hospitalAffiliations: hospitalAffiliations || [],
      phone: phone || null,
      yearsOfExperience: yearsOfExperience || 0,
      isVerified: false,

      // Contribution stats (the "GitHub profile" data)
      stats: {
        totalCasesHandled: 0,
        activeCases: 0,
        totalRecordsAdded: 0,
        totalRecordsUpdated: 0,
        averageResponseTimeHours: null,
        recordAccuracyScore: null, // 0-100, derived from peer feedback
        lastActiveAt: null,
      },

      // Derived specialization tags (built from case history)
      conditionTags: [],

      // Contribution graph: { "YYYY-MM-DD": count }
      contributionGraph: {},

      // Peer endorsements count per skill
      endorsementCounts: {},

      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.collection(COLLECTIONS.USERS).doc(uid), userProfile);
    batch.set(db.collection(COLLECTIONS.DOCTORS).doc(uid), doctorProfile);
    await batch.commit();

    res.status(201).json({
      message: 'Doctor profile created. Pending admin verification.',
      user: userProfile,
      doctor: doctorProfile,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 * Returns the current user's full profile.
 */
export const getMe = async (req, res, next) => {
  try {
    const { uid, role } = req.user;
    const collection = role === 'patient' ? COLLECTIONS.PATIENTS : COLLECTIONS.DOCTORS;
    const profileDoc = await db.collection(collection).doc(uid).get();

    res.json({
      user: req.user,
      profile: profileDoc.exists ? profileDoc.data() : null,
    });
  } catch (err) {
    next(err);
  }
};
