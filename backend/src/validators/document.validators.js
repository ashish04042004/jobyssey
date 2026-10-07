import { z } from 'zod';

export const DOCUMENT_TYPES = ['RESUME', 'COVER_LETTER', 'OTHER'];
export const MIME_EXTENSIONS = Object.freeze({
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
});
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_USER = 20;

const label = z.string().trim().min(1, 'Give the document a name').max(80);

export const uploadRequestSchema = z
  .object({
    label,
    type: z.enum(DOCUMENT_TYPES).default('RESUME'),
    filename: z.string().trim().min(1).max(200),
    mimeType: z.enum(Object.keys(MIME_EXTENSIONS), { error: 'Only PDF and DOCX files are supported' }),
    sizeBytes: z.number().int().min(1, 'The file is empty').max(MAX_DOCUMENT_BYTES, 'Files can be at most 5 MB'),
  })
  .strict()
  .refine((body) => body.filename.toLowerCase().endsWith(`.${MIME_EXTENSIONS[body.mimeType]}`), {
    path: ['filename'],
    message: 'File extension does not match its type',
  });

export const updateDocumentSchema = z
  .object({ label: label.optional(), type: z.enum(DOCUMENT_TYPES).optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const listDocumentsQuery = z.object({ type: z.enum(DOCUMENT_TYPES).optional() });
