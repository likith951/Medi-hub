import { Router } from 'express';
import {
  uploadRecord,
  addRecordVersion,
  getRecordVersions,
  getVersionDownloadUrl,
  getPatientRecords,
  getPatientCommitLog,
} from '../controllers/records.controller.js';
import { authenticate, requireRole, requireVerifiedDoctor } from '../middleware/auth.middleware.js';
import { validate, schemas } from '../middleware/validate.middleware.js';
import { upload } from '../utils/multer.js';

const router = Router();
router.use(authenticate);

// ─── Patient record upload ────────────────────────────────────────────────────

/**
 * POST /api/records
 * Upload a new medical record (patient only)
 */
router.post(
  '/',
  requireRole('patient'),
  upload.single('file'),
  validate(schemas.uploadRecord),
  uploadRecord
);

/**
 * POST /api/records/:recordId/versions
 * Add a new version/commit to an existing record (patient or authorized doctor)
 */
router.post(
  '/:recordId/versions',
  requireVerifiedDoctor,
  upload.single('file'),
  (req, res, next) => {
    // Inject commitMessage validation
    if (!req.body.commitMessage || req.body.commitMessage.length < 5) {
      return res.status(422).json({ error: 'commitMessage must be at least 5 characters.' });
    }
    next();
  },
  addRecordVersion
);

/**
 * GET /api/records/:recordId/versions
 * Get version history (git log) for a record
 */
router.get('/:recordId/versions', requireVerifiedDoctor, getRecordVersions);

/**
 * GET /api/records/:recordId/versions/:versionId/download
 * Get a signed download URL for a specific version
 */
router.get('/:recordId/versions/:versionId/download', requireVerifiedDoctor, getVersionDownloadUrl);

// ─── Patient-scoped routes ────────────────────────────────────────────────────

/**
 * GET /api/patients/:patientId/records
 * List all records for a patient
 */
router.get('/patients/:patientId/records', requireVerifiedDoctor, getPatientRecords);

/**
 * GET /api/patients/:patientId/commits
 * Full commit log for a patient's medical repository
 */
router.get('/patients/:patientId/commits', requireVerifiedDoctor, getPatientCommitLog);

export default router;
