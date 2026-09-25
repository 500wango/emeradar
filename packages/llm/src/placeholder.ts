import { FactBundle, Statement } from './types';

const FORBIDDEN_PHRASES = [
  '保证赚钱',
  '稳赚',
  '100%成功',
  '零风险',
  'guaranteed profit',
  'guaranteed success',
  'zero risk',
  'get rich quick',
];

const PLACEHOLDER_REGEX = /\{\{\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * 08 §6.3: Normalizes placeholder syntax (converts full-width brackets, trims inner whitespace)
 */
export function normalizePlaceholderSyntax(text: string): string {
  // Convert full-width curly braces ｛ and ｝ to standard { and }
  let normalized = text.replace(/｛/g, '{').replace(/｝/g, '}');

  // Normalize whitespace within {{ ... }}
  normalized = normalized.replace(PLACEHOLDER_REGEX, (_match, factId, field) => {
    return `{{${factId.trim()}.${field.trim()}}}`;
  });

  return normalized;
}

/**
 * Extract all placeholders in format {{Fx.field}}
 */
export function extractPlaceholders(
  text: string
): Array<{ raw: string; factId: string; field: string }> {
  const normalized = normalizePlaceholderSyntax(text);
  const matches: Array<{ raw: string; factId: string; field: string }> = [];

  let match: RegExpExecArray | null;
  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = PLACEHOLDER_REGEX.exec(normalized)) !== null) {
    matches.push({
      raw: match[0],
      factId: match[1],
      field: match[2],
    });
  }

  return matches;
}

/**
 * 08 §6.3: Checks forbidden phrasing
 */
export function containsForbiddenPhrases(text: string): boolean {
  const lower = text.toLowerCase();
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * 08 §6.3: Validates citations, placeholder integrity, and renders deterministic text
 */
export function validateAndRenderStatement(
  statement: Statement,
  bundle: FactBundle
): { valid: boolean; reason?: string; renderedText?: string; normalizedText?: string } {
  const normalizedText = normalizePlaceholderSyntax(statement.text);

  // 1. Forbidden phrase check
  if (containsForbiddenPhrases(normalizedText)) {
    return { valid: false, reason: 'FORBIDDEN_PHRASE' };
  }

  const factMap = new Map(bundle.facts.map((f) => [f.id, f]));
  const placeholders = extractPlaceholders(normalizedText);

  // 2. Validate placeholders against cites and fact bundle
  for (const ph of placeholders) {
    // Must be in statement.cites
    if (!statement.cites.includes(ph.factId)) {
      return {
        valid: false,
        reason: `Placeholder ${ph.raw} references uncited fact ${ph.factId}`,
      };
    }

    // Must exist in bundle
    const fact = factMap.get(ph.factId);
    if (!fact) {
      return {
        valid: false,
        reason: `Fact ${ph.factId} does not exist in FactBundle`,
      };
    }

    // Field must exist in fact values
    if (fact.values[ph.field] === undefined) {
      return {
        valid: false,
        reason: `Field ${ph.field} does not exist in fact ${ph.factId}.values`,
      };
    }
  }

  // 3. 08 §6.3: Bare number guard for FACT statements
  // If a FACT statement cites a fact with numeric values, ensure the statement didn't hardcode the bare number
  if (statement.kind === 'FACT') {
    for (const citeId of statement.cites) {
      const fact = factMap.get(citeId);
      if (!fact) continue;

      for (const [field, val] of Object.entries(fact.values)) {
        if (typeof val === 'number') {
          // If value is a specific number (e.g. 12, 45, 980) and appears as a bare token in text without placeholder
          const phString = `{{${citeId}.${field}}}`;
          const isReferencedByPlaceholder = normalizedText.includes(phString);

          if (!isReferencedByPlaceholder) {
            // Check if bare number appears as a standalone word
            const bareNumberRegex = new RegExp(`\\b${val}\\b`);
            if (bareNumberRegex.test(normalizedText)) {
              return {
                valid: false,
                reason: `Bare number ${val} used instead of required placeholder ${phString}`,
              };
            }
          }
        }
      }
    }
  }

  // 4. Deterministic rendering: replace all {{Fx.field}} with fact.values[field]
  let rendered = normalizedText;
  for (const ph of placeholders) {
    const fact = factMap.get(ph.factId);
    if (fact && fact.values[ph.field] !== undefined) {
      rendered = rendered.split(ph.raw).join(String(fact.values[ph.field]));
    }
  }

  return {
    valid: true,
    renderedText: rendered,
    normalizedText,
  };
}

/**
 * 08 §6.3: Validates and renders an entire bundle of statements
 */
export function validateAndRenderBundle(
  bundle: FactBundle,
  statements: Statement[]
): {
  statements: Statement[];
  rejectedCount: number;
  citationValid: boolean;
} {
  const validStatements: Statement[] = [];
  let rejectedCount = 0;

  for (const st of statements) {
    const res = validateAndRenderStatement(st, bundle);
    if (res.valid && res.renderedText) {
      validStatements.push({
        kind: st.kind,
        text: res.normalizedText || st.text,
        cites: st.cites,
        renderedText: res.renderedText,
      });
    } else {
      rejectedCount++;
    }
  }

  return {
    statements: validStatements,
    rejectedCount,
    citationValid: rejectedCount === 0 && validStatements.length > 0,
  };
}
