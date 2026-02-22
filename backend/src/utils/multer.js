import multer from 'multer';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/dicom',
  'application/dicom',
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// Use memory storage — files are piped directly to Firebase Storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `File type ${file.mimetype} not allowed. Allowed types: PDF, JPEG, PNG, WEBP, GIF, DICOM`
      ),
      false
    );
  }
};

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});
