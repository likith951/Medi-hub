import { db, Timestamp, COLLECTIONS } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Log an activity event to the audit trail.
 * Every meaningful action in Medilocker is recorded here.
 */
export const logActivity = async ({ actorId, actorRole, action, resourceId, metadata = {} }) => {
  try {
    const log = {
      id: uuidv4(),
      actorId,
      actorRole,
      action,
      resourceId: resourceId || null,
      metadata,
      createdAt: Timestamp.now(),
    };

    await db.collection(COLLECTIONS.ACTIVITY_LOG).doc(log.id).set(log);
  } catch (err) {
    // Non-blocking: don't fail the main request if logging fails
    console.error('Activity logging failed:', err.message);
  }
};
