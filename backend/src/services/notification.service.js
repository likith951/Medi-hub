import { db, Timestamp, COLLECTIONS } from '../config/firebase.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a notification for a user.
 */
export const createNotification = async ({ recipientId, type, title, body, metadata = {} }) => {
  try {
    const notificationId = uuidv4();
    const notification = {
      id: notificationId,
      recipientId,
      type,
      title,
      body,
      metadata,
      isRead: false,
      readAt: null,
      createdAt: Timestamp.now(),
    };

    await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId).set(notification);
    return notification;
  } catch (err) {
    console.error('createNotification failed:', err.message);
  }
};
