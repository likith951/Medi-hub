import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load serviceAccountKey.json directly — no dotenv needed
const serviceAccountPath = path.join(__dirname, '../../serviceAccountKey.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

const initializeFirebase = () => {
  if (admin.apps.length > 0) return admin.apps[0];

  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: serviceAccount.project_id + '.appspot.com',
    databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
  });

  console.log(`✅ Firebase initialised — project: ${serviceAccount.project_id}`);
  return app;
};

initializeFirebase();

export const db = admin.firestore();
export const auth = admin.auth();
export const storage = admin.storage();
export const bucket = admin.storage().bucket();
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;

// Firestore collection names — single source of truth
export const COLLECTIONS = {
  USERS: 'users',
  PATIENTS: 'patients',
  DOCTORS: 'doctors',
  RECORDS: 'records',           // medical records (versioned)
  RECORD_VERSIONS: 'record_versions',
  ACCESS_REQUESTS: 'access_requests',
  COLLABORATIONS: 'collaborations',
  COMMITS: 'commits',           // audit log of every record change
  ENDORSEMENTS: 'endorsements',
  NOTIFICATIONS: 'notifications',
  ACTIVITY_LOG: 'activity_log',
};

export default admin;
