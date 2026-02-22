import Joi from 'joi';

/**
 * Validates req.body against a Joi schema.
 * Returns 422 with field-level errors if validation fails.
 */
export const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const errors = error.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message.replace(/['"]/g, ''),
    }));
    return res.status(422).json({ error: 'Validation failed', errors });
  }

  req.body = value;
  next();
};

// ─── Schemas ────────────────────────────────────────────────────────────────

export const schemas = {
  registerPatient: Joi.object({
    displayName: Joi.string().min(2).max(80).required(),
    dateOfBirth: Joi.string().isoDate().required(),
    gender: Joi.string().valid('male', 'female', 'other', 'prefer_not_to_say').required(),
    bloodGroup: Joi.string()
      .valid('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')
      .optional(),
    phone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
    emergencyContact: Joi.object({
      name: Joi.string().required(),
      phone: Joi.string().required(),
      relation: Joi.string().required(),
    }).optional(),
  }),

  registerDoctor: Joi.object({
    displayName: Joi.string().min(2).max(80).required(),
    specialization: Joi.string().min(2).max(100).required(),
    qualifications: Joi.array().items(Joi.string()).min(1).required(),
    licenseNumber: Joi.string().min(4).max(50).required(),
    hospitalAffiliations: Joi.array().items(Joi.string()).optional(),
    phone: Joi.string().pattern(/^\+?[0-9]{7,15}$/).optional(),
    yearsOfExperience: Joi.number().integer().min(0).max(60).optional(),
  }),

  uploadRecord: Joi.object({
    title: Joi.string().min(2).max(200).required(),
    recordType: Joi.string()
      .valid('prescription', 'lab_report', 'xray', 'discharge_summary', 'vaccination', 'imaging', 'other')
      .required(),
    description: Joi.string().max(1000).optional(),
    tags: Joi.array().items(Joi.string().max(50)).max(10).optional(),
    issuedBy: Joi.string().max(100).optional(),
    issuedDate: Joi.string().isoDate().optional(),
    commitMessage: Joi.string().min(5).max(300).required(),
  }),

  accessRequest: Joi.object({
    patientId: Joi.string().required(),
    reason: Joi.string().min(10).max(500).required(),
    accessLevel: Joi.string().valid('read', 'read_write').default('read'),
    requestedRecordTypes: Joi.array()
      .items(Joi.string().valid('prescription', 'lab_report', 'xray', 'discharge_summary', 'vaccination', 'imaging', 'other', 'all'))
      .min(1)
      .required(),
    expiryDays: Joi.number().integer().min(1).max(365).default(30),
  }),

  accessRequestResponse: Joi.object({
    approved: Joi.boolean().required(),
    note: Joi.string().max(300).optional(),
  }),

  endorsement: Joi.object({
    targetDoctorId: Joi.string().required(),
    skill: Joi.string().min(2).max(100).required(),
    note: Joi.string().max(400).optional(),
  }),
};
