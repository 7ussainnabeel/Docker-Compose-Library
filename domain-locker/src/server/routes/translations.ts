import { defineEventHandler, getQuery } from 'h3';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Used for SSR to load translatable text content to be rendered on the server
 * Will use English (en) by default unless the `lang` query parm is specified
 */
export default defineEventHandler((event) => {
  const query = getQuery(event);
  const lang = query['lang'] || 'en';
  const filePath = join(process.cwd(), `src/assets/i18n/${lang}.json`)
  try {
    const translations = JSON.parse(readFileSync(filePath, 'utf8'));
    return { translations };
  } catch (error) {
    console.error(`Error loading translation file for language "${lang}":`, error);
    return { error: `Translation file not found for language: ${lang}` };
  }
});
