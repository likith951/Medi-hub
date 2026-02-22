import { Router } from 'express';
import {
  createAccessRequest,
  respondToAccessRequest,
  revokeAccess,
  getIncomingRequests,
  getOutgoingRequests,
  getPatientCollaborators,
} from '../controllers/access-requests.controller.js';
import { authenticate, requireRole, requireVerifiedDoctor } from '../middleware/auth.middleware.js';
import { validate, schemas } from '../middleware/validate.middleware.js';

const router = Router();
router.use(authenticate);

/**
 * POST /api/access-requests
 * Doctor creates a "pull request" for patient records
 */
router.post(
  '/',
  requireRole('doctor'),
  requireVerifiedDoctor,
  validate(schemas.accessRequest),
  createAccessRequest
);

/**
 * GET /api/access-requests/incoming
 * Patient sees all access requests addressed to them
 */
router.get('/incoming', requireRole('patient'), getIncomingRequests);

/**
 * GET /api/access-requests/outgoing
 * Doctor sees all their sent access requests
 */
router.get('/outgoing', requireRole('doctor'), getOutgoingRequests);

/**
 * PATCH /api/access-requests/:requestId/respond
 * Patient approves or denies an access request
 */
router.patch(
  '/:requestId/respond',
  requireRole('patient'),
  validate(schemas.accessRequestResponse),
  respondToAccessRequest
);

/**
 * DELETE /api/access-requests/:requestId/revoke
 * Patient revokes an approved access grant
 */
router.delete('/:requestId/revoke', requireRole('patient'), revokeAccess);

/**
 * GET /api/patients/:patientId/collaborators
 * Get all doctors currently with access to a patient's records
 */
router.get('/patients/:patientId/collaborators', getPatientCollaborators);

export default router;
