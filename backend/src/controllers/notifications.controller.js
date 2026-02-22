import { db, FieldValue, Timestamp, COLLECTIONS } from '../config/firebase.js';

/**
 * GET /api/notifications
 * Returns the current user's notifications, most recent first.
 */
export const getNotifications = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { unreadOnly } = req.query;

    let query = db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('recipientId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(50);

    if (unreadOnly === 'true') {
      query = query.where('isRead', '==', false);
    }

    const snap = await query.get();
    const notifications = snap.docs.map((d) => d.data());

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    res.json({ notifications, unreadCount, total: notifications.length });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/notifications/:notificationId/read
 * Mark a notification as read.
 */
export const markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.uid;
    const { notificationId } = req.params;

    const notifRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
    const notifDoc = await notifRef.get();

    if (!notifDoc.exists) return res.status(404).json({ error: 'Notification not found.' });
    if (notifDoc.data().recipientId !== userId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    await notifRef.update({ isRead: true, readAt: Timestamp.now() });
    res.json({ message: 'Notification marked as read.' });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read.
 */
export const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.uid;

    const snap = await db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('recipientId', '==', userId)
      .where('isRead', '==', false)
      .get();

    if (snap.empty) return res.json({ message: 'No unread notifications.' });

    const batch = db.batch();
    const now = Timestamp.now();
    snap.docs.forEach((d) => {
      batch.update(d.ref, { isRead: true, readAt: now });
    });
    await batch.commit();

    res.json({ message: `Marked ${snap.size} notifications as read.` });
  } catch (err) {
    next(err);
  }
};
