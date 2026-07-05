import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RequestBody = {
  image?: {
    mimeType: string;
    data: string;
  };
};

type ExtractedMedicine = {
  name?: unknown;
  rawNameLine?: unknown;
  genericName?: unknown;
  brandName?: unknown;
  strength?: unknown;
  form?: unknown;
  instructions?: unknown;
  scheduleTimes?: unknown;
  durationDays?: unknown;
  quantity?: unknown;
  confidence?: unknown;
  needsReview?: unknown;
};

type OcrMedicineRow = {
  rowNumber?: unknown;
  rawText?: unknown;
  rawNameLine?: unknown;
  instructionText?: unknown;
  quantity?: unknown;
  unit?: unknown;
  confidence?: unknown;
  warnings?: unknown;
};

type OcrDraft = {
  patientName?: unknown;
  medicineRows?: OcrMedicineRow[];
  doctorInstructionText?: unknown;
  warnings?: unknown;
};

type ExtractionDraft = {
  patientName?: unknown;
  medicines?: ExtractedMedicine[];
  doctorNotes?: unknown;
  appointments?: unknown;
  warnings?: unknown;
};

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

const medicineOcrPrompt = [
  'You are a strict OCR transcription engine for Vietnamese prescription images.',
  'Your only job in this pass is to transcribe visible medicine rows and doctor notes. Do not decide which part is more important.',
  'Typography rule: bold text has NO priority. Bold words are often brand names inside parentheses, but the complete medicine name includes BOTH normal-weight text and bold text.',
  'For every numbered medicine row 1, 2, 3, 4, 5..., copy the full row text as rawText.',
  'For rawNameLine, copy the exact visible text after the row number and before dosage/use instructions such as "Uống", "Bôi", "Thoa", "Dùng", and before the quantity column like "X 30 Viên".',
  'rawNameLine MUST include all text outside parentheses and all text inside parentheses. Never return only the bold/parenthesized part.',
  'Examples of correct rawNameLine values:',
  '1. Isotretinoin 25mg (Dokreal 25mg) -> "Isotretinoin 25mg (Dokreal 25mg)"',
  '3. Cefixime (Cefimed 200mg) -> "Cefixime (Cefimed 200mg)"',
  '4. Clindamycin (dưới dạng clindamycin phosphat 11.88mg) 10mg/1ml (Monithin 30ml) -> copy that whole string, not only "Monithin 30ml".',
  '5. Adalcrem plus 15g (Adapalene 15mg + Clindamycin 150mg) -> copy that whole string.',
  'Return valid JSON only with this exact shape:',
  '{ "patientName": string, "medicineRows": [{ "rowNumber": number, "rawText": string, "rawNameLine": string, "instructionText": string, "quantity": number, "unit": string, "confidence": number, "warnings": string[] }], "doctorInstructionText": string, "warnings": string[] }',
  'If a name line contains parentheses in the image but your rawNameLine has no parentheses, add a warning for that row.',
].join('\n');

function buildExtractionPrompt(ocrDraft: NormalizedOcrDraft) {
  return [
    'You are converting OCR text from a Vietnamese prescription into structured reminder data. Extract data only; do not provide medical advice.',
    'Use the OCR JSON below as the source of truth. Do not invent a different medicine name from brand/generic fields.',
    'For each medicineRows[i], medicines[i].name MUST equal medicineRows[i].rawNameLine exactly.',
    'For each medicineRows[i], medicines[i].rawNameLine MUST also equal medicineRows[i].rawNameLine exactly.',
    'Use brandName/genericName only as helper fields if obvious, but never replace the complete name.',
    'Each medicine row, topical solution, cream, tube, bottle, or gel must become one separate medicines[] item. Do not merge rows. Do not skip topical medicines.',
    'For form, use Vietnamese labels such as "viên", "lọ", "tuýp", "chai", "gói", "ống", "gel", "kem". If instruction says bôi or unit is lọ/tuýp, do not default to viên.',
    'Extract doctorInstructionText into doctorNotes. Split into separate actionable notes. Do not summarize.',
    'For durationDays, only return a positive integer when the duration is explicitly visible for that same medicine row, such as "Uá»‘ng 10 ngÃ y" or "BÃ´i 30 ngÃ y". If no duration is stated, omit durationDays or return null. Never return 0.',
    'Do not add generic notes like "Duration not explicitly stated" to needsReview; missing duration is handled by the app.',
    'Return valid JSON with exactly this shape:',
    '{ "patientName": string, "medicines": [{ "name": string, "rawNameLine": string, "genericName": string, "brandName": string, "strength": string, "form": string, "instructions": string, "scheduleTimes": string[], "durationDays": number, "quantity": number, "confidence": number, "needsReview": string[] }], "doctorNotes": string[], "appointments": [{ "title": string, "appointmentAt": string, "notes": string }], "warnings": string[] }',
    'Use HH:mm for scheduleTimes. Guess scheduleTimes only when visible or strongly implied by words like sáng/chiều/tối. Put uncertainty in needsReview or warnings.',
    'OCR JSON:',
    JSON.stringify(ocrDraft),
  ].join('\n');
}

type NormalizedOcrMedicineRow = {
  rowNumber?: number;
  rawText: string;
  rawNameLine: string;
  instructionText: string;
  quantity?: number;
  unit: string;
  confidence?: number;
  warnings: string[];
};

type NormalizedOcrDraft = {
  patientName: string;
  medicineRows: NormalizedOcrMedicineRow[];
  doctorInstructionText: string;
  warnings: string[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) throw new Error('Missing GEMINI_API_KEY');

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return Response.json(
        { error: 'Bạn cần đăng nhập trước khi dùng Gemini OCR.' },
        { status: 401, headers: corsHeaders },
      );
    }

    const { data: householdId, error: householdError } = await supabase.rpc('ensure_user_profile');
    if (householdError) throw householdError;

    const body = (await req.json()) as RequestBody;
    if (!body.image?.data || !body.image.mimeType) {
      throw new Error('Missing image payload');
    }

    const model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    const ocrCall = await callGeminiJson(geminiApiKey, model, [
      { text: medicineOcrPrompt },
      {
        inlineData: {
          mimeType: body.image.mimeType,
          data: body.image.data,
        },
      },
    ]);
    const ocrDraft = normalizeOcrDraft(JSON.parse(ocrCall.text) as OcrDraft);

    let parseRaw: unknown = null;
    let parsedDraft: ExtractionDraft;
    try {
      const parseCall = await callGeminiJson(geminiApiKey, model, [{ text: buildExtractionPrompt(ocrDraft) }]);
      parseRaw = parseCall.raw;
      parsedDraft = JSON.parse(parseCall.text) as ExtractionDraft;
    } catch (parseError) {
      console.error(parseError);
      parsedDraft = draftFromOcr(ocrDraft);
      ocrDraft.warnings.push('Gemini parse pass failed; draft was generated directly from OCR rows.');
    }

    const draft = normalizeExtractionDraft(parsedDraft, ocrDraft);

    await supabase.from('extraction_jobs').insert({
      household_id: householdId,
      raw_result: {
        ocrRaw: ocrCall.raw,
        normalizedOcr: ocrDraft,
        parseRaw,
      },
      draft,
      status: 'draft',
    });

    return Response.json(draft, { headers: corsHeaders });
  } catch (error) {
    console.error(error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: corsHeaders },
    );
  }
});

async function callGeminiJson(apiKey: string, model: string, parts: GeminiPart[]) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0,
          maxOutputTokens: 8192,
        },
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const raw = await response.json();
  const text = raw.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return { raw, text };
}

function normalizeOcrDraft(draft: OcrDraft): NormalizedOcrDraft {
  const warnings = toStringArray(draft.warnings);
  const medicineRows = Array.isArray(draft.medicineRows)
    ? draft.medicineRows.map((row, index) => normalizeOcrMedicineRow(row, index + 1, warnings))
    : [];

  return {
    patientName: toCleanString(draft.patientName),
    medicineRows,
    doctorInstructionText: toCleanString(draft.doctorInstructionText),
    warnings,
  };
}

function normalizeOcrMedicineRow(row: OcrMedicineRow, fallbackRowNumber: number, globalWarnings: string[]): NormalizedOcrMedicineRow {
  const rawText = toCleanString(row.rawText);
  const rawNameLine = toCleanString(row.rawNameLine) || extractNameLineFromRawText(rawText);
  const warnings = toStringArray(row.warnings);
  const rowNumber = toOptionalNumber(row.rowNumber) ?? fallbackRowNumber;

  if (!rawNameLine) {
    warnings.push('Không đọc được dòng tên thuốc đầy đủ.');
    globalWarnings.push(`Không đọc được tên thuốc dòng ${rowNumber}.`);
  }

  return {
    rowNumber,
    rawText,
    rawNameLine,
    instructionText: toCleanString(row.instructionText) || extractInstructionFromRawText(rawText),
    quantity: toOptionalNumber(row.quantity),
    unit: toCleanString(row.unit),
    confidence: toOptionalNumber(row.confidence),
    warnings,
  };
}

function draftFromOcr(ocrDraft: NormalizedOcrDraft): ExtractionDraft {
  return {
    patientName: ocrDraft.patientName,
    medicines: ocrDraft.medicineRows.map((row) => ({
      name: row.rawNameLine,
      rawNameLine: row.rawNameLine,
      form: row.unit,
      instructions: row.instructionText,
      quantity: row.quantity,
      confidence: row.confidence,
      needsReview: row.warnings,
    })),
    doctorNotes: ocrDraft.doctorInstructionText ? [ocrDraft.doctorInstructionText] : [],
    appointments: [],
    warnings: ocrDraft.warnings,
  };
}

function normalizeExtractionDraft(draft: ExtractionDraft, ocrDraft?: NormalizedOcrDraft) {
  const warnings = [...toStringArray(draft.warnings), ...(ocrDraft?.warnings ?? [])];
  const parsedMedicines = Array.isArray(draft.medicines) ? draft.medicines : [];
  const rowCount = Math.max(parsedMedicines.length, ocrDraft?.medicineRows.length ?? 0);
  const medicines = Array.from({ length: rowCount }, (_, index) => {
    const ocrRow = ocrDraft?.medicineRows[index];
    const medicine = parsedMedicines[index] ?? {
      name: ocrRow?.rawNameLine,
      rawNameLine: ocrRow?.rawNameLine,
      form: ocrRow?.unit,
      instructions: ocrRow?.instructionText,
      quantity: ocrRow?.quantity,
      confidence: ocrRow?.confidence,
      needsReview: ocrRow?.warnings,
    };
    return normalizeMedicine(medicine, warnings, ocrRow);
  }).filter((medicine) => medicine.name || medicine.instructions);

  const doctorNotes = toStringArray(draft.doctorNotes);

  return {
    ...draft,
    patientName: toCleanString(draft.patientName) || ocrDraft?.patientName || '',
    medicines,
    doctorNotes: doctorNotes.length ? doctorNotes : (ocrDraft?.doctorInstructionText ? [ocrDraft.doctorInstructionText] : []),
    appointments: Array.isArray(draft.appointments) ? draft.appointments : [],
    warnings: Array.from(new Set(warnings)),
  };
}

function normalizeMedicine(medicine: ExtractedMedicine, warnings: string[], ocrRow?: NormalizedOcrMedicineRow) {
  const ocrRawNameLine = ocrRow?.rawNameLine ?? '';
  const rawNameLine = ocrRawNameLine || toCleanString(medicine.rawNameLine);
  const originalName = toCleanString(medicine.name);
  const genericName = toCleanString(medicine.genericName);
  const brandName = toCleanString(medicine.brandName);
  const normalizedName = buildCompleteMedicineName({
    rawNameLine,
    name: originalName,
    genericName,
    brandName,
  });

  const needsReview = [...(ocrRow?.warnings ?? []), ...toStringArray(medicine.needsReview)].filter((note) => !isMissingDurationReview(note));
  if (ocrRawNameLine && originalName && normalizeForCompare(originalName) !== normalizeForCompare(ocrRawNameLine)) {
    needsReview.push('Tên parse ban đầu khác dòng OCR đầy đủ; app đã ưu tiên dòng OCR gốc.');
  }
  if (!rawNameLine && normalizedName !== originalName) {
    needsReview.push('Tên thuốc đã được ghép từ các phần Gemini đọc được; đối chiếu lại với dòng tên thuốc trên đơn gốc.');
  }
  if (!hasParentheticalContent(normalizedName) && (hasParentheticalContent(originalName) || genericName || brandName)) {
    warnings.push(`Cần kiểm tra lại tên thuốc: ${normalizedName}`);
  }

  return {
    ...medicine,
    name: normalizedName,
    rawNameLine: rawNameLine || normalizedName,
    genericName,
    brandName,
    instructions: toCleanString(medicine.instructions) || ocrRow?.instructionText || '',
    scheduleTimes: toStringArray(medicine.scheduleTimes),
    durationDays: toPositiveOptionalNumber(medicine.durationDays),
    quantity: toOptionalNumber(medicine.quantity) ?? ocrRow?.quantity,
    confidence: toOptionalNumber(medicine.confidence) ?? ocrRow?.confidence,
    needsReview: Array.from(new Set(needsReview)),
  };
}

function buildCompleteMedicineName(input: {
  rawNameLine: string;
  name: string;
  genericName: string;
  brandName: string;
}) {
  if (input.rawNameLine) return input.rawNameLine;

  let name = input.name;
  const helperNames = [input.genericName, input.brandName]
    .map((value) => value.trim())
    .filter((value) => value && !containsName(name, value));

  if (!name && helperNames.length) {
    name = helperNames.join(' / ');
  }

  helperNames.forEach((helperName) => {
    name = name ? `${name} (${helperName})` : helperName;
  });

  return name;
}

function containsName(source: string, value: string) {
  if (!source || !value) return false;
  return normalizeForCompare(source).includes(normalizeForCompare(value));
}

function extractNameLineFromRawText(value: string) {
  const text = stripRowNumber(value);
  if (!text) return '';

  const instructionIndex = findFirstIndex(text, [
    /\bUống\b/i,
    /\bBôi\b/i,
    /\bThoa\b/i,
    /\bDùng\b/i,
    /\bNgậm\b/i,
    /\bNhỏ\b/i,
    /\bXịt\b/i,
    /\s+[xX]\s*\d+\b/,
  ]);

  const name = instructionIndex >= 0 ? text.slice(0, instructionIndex) : text;
  return name.replace(/\s+/g, ' ').replace(/[.;,:-]+$/g, '').trim();
}

function extractInstructionFromRawText(value: string) {
  const text = stripRowNumber(value);
  if (!text) return '';

  const instructionIndex = findFirstIndex(text, [
    /\bUống\b/i,
    /\bBôi\b/i,
    /\bThoa\b/i,
    /\bDùng\b/i,
    /\bNgậm\b/i,
    /\bNhỏ\b/i,
    /\bXịt\b/i,
  ]);

  if (instructionIndex < 0) return '';
  return text
    .slice(instructionIndex)
    .replace(/\s+[xX]\s*\d+\s*(Viên|Lọ|Tuýp|Tube|Chai|Gói|Ống)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripRowNumber(value: string) {
  return value.replace(/^\s*\d+\s*[.)-]?\s*/, '').trim();
}

function findFirstIndex(text: string, patterns: RegExp[]) {
  return patterns.reduce((best, pattern) => {
    const match = pattern.exec(text);
    if (!match || match.index < 0) return best;
    return best < 0 ? match.index : Math.min(best, match.index);
  }, -1);
}

function normalizeForCompare(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasParentheticalContent(value: string) {
  return /\(.+\)/.test(value);
}

function toCleanString(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(toCleanString).filter(Boolean);
}

function toOptionalNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function toPositiveOptionalNumber(value: unknown) {
  const numberValue = toOptionalNumber(value);
  if (numberValue === undefined || numberValue <= 0) return undefined;
  return Math.floor(numberValue);
}

function isMissingDurationReview(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('duration not explicitly') ||
    normalized.includes('duration not stated') ||
    normalized.includes('duration missing') ||
    normalized.includes('không thấy thời gian dùng') ||
    normalized.includes('khong thay thoi gian dung') ||
    normalized.includes('chưa rõ thời gian dùng') ||
    normalized.includes('chua ro thoi gian dung')
  );
}
