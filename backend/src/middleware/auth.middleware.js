import { auth, db, COLLECTIONS } from '../config/firebase.js';

/**
 * Verifies Firebase ID token from Authorization header.
 * Attaches decoded token + full user doc to req.user
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await auth.verifyIdToken(idToken);

    // Fetch the user's Firestore profile
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User profile not found. Please complete registration.' });
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      ...userDoc.data(),
    };

    next();
  } catch (err) {
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired. Please sign in again.' });
    }
    if (err.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    console.error('Auth middleware error:', err.message);
    return res.status(401).json({ error: 'Authentication failed.' });
  }
};

/**
 * Role-based access control middleware factory
 * Usage: requireRole('doctor') or requireRole('patient')
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      error: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`,
    });
  }
  next();
};

/**
 * Middleware: doctor must be verified by admin before accessing protected routes
 */
export const requireVerifiedDoctor = (req, res, next) => {
  if (req.user.role !== 'doctor') return next();
  if (!req.user.isVerified) {
    return res.status(403).json({
      error: 'Doctor account pending verification. Please wait for admin approval.',
    });
  }
  next();
};
