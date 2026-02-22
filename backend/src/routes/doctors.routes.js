import { Router } from 'express';
import {
  discoverDoctors,
  getDoctorProfile,
  getDoctorContributionGraph,
  endorseDoctor,
  getSpecializations,
} from '../controllers/doctors.controller.js';
import { authenticate, requireRole, requireVerifiedDoctor } from '../middleware/auth.middleware.js';
import { validate, schemas } from '../middleware/validate.middleware.js';

const router = Router();

// Public routes (still need auth to prevent scraping)
router.use(authenticate);

/**
 * GET /api/doctors
 * Discover doctors by contribution data (no ads, no paid placement)
 */
router.get('/', discoverDoctors);

/**
 * GET /api/doctors/specializations
 * List all unique specializations and condition tags
 */
router.get('/specializations', getSpecializations);

/**
 * GET /api/doctors/:doctorId
 * View a doctor's "GitHub profile" — contribution stats, graph, endorsements
 */
router.get('/:doctorId', getDoctorProfile);

/**
 * GET /api/doctors/:doctorId/contribution-graph
 * 365-day contribution activity for a doctor
 */
router.get('/:doctorId/contribution-graph', getDoctorContributionGraph);

/**
 * POST /api/doctors/:doctorId/endorse
 * Verified doctor endorses another doctor for a skill (peer endorsements only)
 */
router.post(
  '/:doctorId/endorse',
  requireRole('doctor'),
  requireVerifiedDoctor,
  validate(schemas.endorsement),
  endorseDoctor
);

export default router;
