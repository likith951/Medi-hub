# 🏥 Medilocker — Secure Digital Health Record Platform

> **Git-inspired medical records. GitHub-style doctor discovery. Zero ratings, zero ads.**

Medilocker is a backend API where every **patient is a repository** and every **doctor is a contributor**. Medical records are versioned like git commits. Doctor access is granted like a pull request. Trust is built purely from verifiable contribution data.

---

## 🗂️ Project Structure

```
medilocker/
├── src/
│   ├── config/
│   │   └── firebase.js          # Firebase Admin SDK init + collection names
│   ├── controllers/
│   │   ├── auth.controller.js         # Registration, profile
│   │   ├── records.controller.js      # Versioned record management (git-like)
│   │   ├── access-requests.controller.js  # Pull-request-style access system
│   │   ├── doctors.controller.js      # Discovery + contribution profiles
│   │   └── notifications.controller.js
│   ├── middleware/
│   │   ├── auth.middleware.js         # Firebase token verification + RBAC
│   │   ├── validate.middleware.js     # Joi request validation
│   │   └── error.middleware.js        # Global error handler
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── records.routes.js
│   │   ├── access-requests.routes.js
│   │   ├── doctors.routes.js
│   │   └── notifications.routes.js
│   ├── services/
│   │   ├── activity.service.js        # Audit trail logging
│   │   ├── doctor-stats.service.js    # Contribution graph + metrics
│   │   └── notification.service.js
│   ├── utils/
│   │   └── multer.js                  # File upload config
│   └── index.js                       # Express app
├── functions/
│   └── index.js                       # Firebase Cloud Functions (cron + triggers)
├── firestore.rules                    # Firestore security rules
├── firestore.indexes.json             # Composite indexes
├── storage.rules                      # Storage security rules
├── firebase.json
├── .env.example
└── package.json
```

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Firebase setup
1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore**, **Firebase Auth**, and **Firebase Storage**
3. Go to Project Settings → Service Accounts → Generate a new private key
4. Save it as `serviceAccountKey.json` in the project root

### 3. Configure environment
```bash
cp .env.example .env
# Edit .env with your Firebase project values
```

### 4. Deploy Firestore rules & indexes
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### 5. Start the server
```bash
npm run dev    # development (nodemon)
npm start      # production
```

---

## 🔐 Authentication

All API routes require a Firebase ID Token in the Authorization header:

```
Authorization: Bearer <firebase-id-token>
```

The client signs in via Firebase Auth (Email/Password, Google, etc.), gets an ID token, and passes it with every request.

---

## 📡 API Reference

### Auth

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register/patient` | Any | Create patient profile post-signup |
| POST | `/api/auth/register/doctor` | Any | Create doctor profile (pending verification) |
| GET | `/api/auth/me` | Any | Get current user's profile |

**Register Patient body:**
```json
{
  "displayName": "Aarav Shah",
  "dateOfBirth": "1990-05-15",
  "gender": "male",
  "bloodGroup": "B+",
  "phone": "+919876543210",
  "emergencyContact": { "name": "Priya Shah", "phone": "+919876543211", "relation": "spouse" }
}
```

**Register Doctor body:**
```json
{
  "displayName": "Dr. Meera Nair",
  "specialization": "Cardiology",
  "qualifications": ["MBBS", "MD (Cardiology)", "DM"],
  "licenseNumber": "MCI-12345",
  "hospitalAffiliations": ["Apollo Hospitals", "AIIMS"],
  "yearsOfExperience": 12
}
```

---

### Medical Records (Git-like versioning)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/records` | Patient | Upload a new record (first commit) |
| POST | `/api/records/:recordId/versions` | Patient / Doctor (write) | Add new version (commit) |
| GET | `/api/records/:recordId/versions` | Patient / Doctor | Version history (git log) |
| GET | `/api/records/:recordId/versions/:versionId/download` | Patient / Doctor | Get signed download URL |
| GET | `/api/patients/:patientId/records` | Patient / Doctor | List all records |
| GET | `/api/patients/:patientId/commits` | Patient / Doctor | Full commit log |

**Upload record (multipart/form-data):**
```
file          → binary file (PDF, JPEG, PNG, DICOM — max 20MB)
title         → "Blood Test Report Q1 2025"
recordType    → prescription | lab_report | xray | discharge_summary | vaccination | imaging | other
description   → (optional)
tags          → ["diabetes", "HbA1c"]
issuedBy      → "Apollo Diagnostics"
issuedDate    → "2025-01-15"
commitMessage → "Upload initial CBC report — baseline before medication"
```

---

### Access Requests (Pull Request System)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| POST | `/api/access-requests` | Doctor | Request access to a patient's records |
| GET | `/api/access-requests/incoming` | Patient | View all incoming requests |
| GET | `/api/access-requests/outgoing` | Doctor | View all sent requests |
| PATCH | `/api/access-requests/:id/respond` | Patient | Approve or deny |
| DELETE | `/api/access-requests/:id/revoke` | Patient | Revoke approved access |
| GET | `/api/patients/:patientId/collaborators` | Patient | List all active collaborators |

**Create access request:**
```json
{
  "patientId": "patient-uid-here",
  "reason": "Post-operative follow-up for cardiac surgery scheduled next week.",
  "accessLevel": "read",
  "requestedRecordTypes": ["lab_report", "xray", "discharge_summary"],
  "expiryDays": 30
}
```

**Respond to request:**
```json
{ "approved": true, "note": "Access granted for 30 days. Please keep records confidential." }
```

---

### Doctor Discovery (GitHub-Profile-Style)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/doctors` | Any | Discover doctors by contribution data |
| GET | `/api/doctors/specializations` | Any | All unique specializations + condition tags |
| GET | `/api/doctors/:doctorId` | Any | Doctor's full contribution profile |
| GET | `/api/doctors/:doctorId/contribution-graph` | Any | 365-day activity graph |
| POST | `/api/doctors/:doctorId/endorse` | Verified Doctor | Peer endorsement for a skill |

**Discovery filters (query params):**
```
?specialization=Cardiology
&conditionTag=hypertension
&minCases=50
&sortBy=totalCasesHandled    # or: recordAccuracyScore | averageResponseTimeHours
&limit=20
&page=1
```

**Doctor profile response includes:**
- `stats.totalCasesHandled` — total patients handled
- `stats.activeCases` — currently active cases
- `stats.averageResponseTimeHours` — how fast they respond
- `stats.recordAccuracyScore` — 0–100, derived from peer endorsements vs case count
- `contributionGraph` — `{ "2025-01-15": 3, "2025-01-16": 1, ... }`
- `conditionTags` — derived from real case history
- `endorsementCounts` — `{ "cardiac surgery": 12, "ECG interpretation": 8 }`

---

### Notifications

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/notifications` | Any | Get notifications (`?unreadOnly=true`) |
| PATCH | `/api/notifications/:id/read` | Any | Mark one as read |
| PATCH | `/api/notifications/read-all` | Any | Mark all as read |

---

## 🧠 Core Design Concepts

### Patient = Repository
- Every patient has a "repo" of medical records
- Nothing is ever deleted or overwritten
- Every change is a versioned "commit" with a message, author, and timestamp

### Doctor = Contributor
- Doctors request access like a pull request
- Patient approves/denies
- Multiple doctors can collaborate on one patient's case
- Every contribution is tracked

### Doctor's GitHub Profile
A doctor's credibility is built entirely from real, verifiable data:

| Metric | How it's built |
|--------|---------------|
| Total cases handled | Approved access requests |
| Contribution graph | Daily activity tracking |
| Condition specialization | Tags extracted from case history |
| Record accuracy score | Peer endorsements ÷ total cases |
| Average response time | Time between request and approval |
| Peer endorsements | Verified doctors only, per skill |

> ❌ No star ratings. ❌ No paid placements. ❌ No patient reviews. ✅ Only transparent, contribution-based trust.

---

## 🔒 Security

- Firebase ID token verification on every request
- Role-based access control (`patient` / `doctor`)
- Doctors must be **admin-verified** before accessing records
- Access automatically **expires** after the granted period
- File uploads go directly to Firebase Storage via Admin SDK (no client upload)
- Signed URLs for downloads (1-hour expiry)
- Firestore security rules as second layer of defense
- Rate limiting on all API routes

---

## 🛠️ Cloud Functions

Deploy scheduled tasks and event triggers:

```bash
cd functions
npm install
firebase deploy --only functions
```

Functions included:
- **`expireAccessRequests`** — hourly cron to expire stale access grants
- **`onEndorsementCreated`** — recalculates doctor accuracy score on new endorsement
- **`onAccessRequestResponded`** — updates doctor response time stats

---

## 📋 Firestore Collections

| Collection | Description |
|------------|-------------|
| `users` | Auth profiles (uid, role, email) |
| `patients` | Patient health profiles |
| `doctors` | Doctor profiles + contribution stats |
| `records` | Medical records (current version pointer) |
| `record_versions` | Subcollection — all versions of each record |
| `access_requests` | Pull-request-style access grants |
| `commits` | Global audit log of all record changes |
| `endorsements` | Peer endorsements between verified doctors |
| `notifications` | In-app notification inbox |
| `activity_log` | Full audit trail |
