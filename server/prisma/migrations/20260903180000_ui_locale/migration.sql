-- UI language on `user_preferences`.
--
-- Additive and safe on a populated database: one column with NOT NULL DEFAULT
-- 'en', so existing rows are backfilled to English in place. That is the
-- correct default rather than guessing from a stored country or an old
-- Accept-Language: every account created before this migration chose their
-- language implicitly by using the English UI, and silently switching someone
-- to Czech on their next sign-in would be worse than leaving them where they are.
-- New accounts get their browser's language from the client instead, which
-- `LanguageService` resolves before `/me` is ever read.
--
-- `TEXT` rather than an enum, matching the neighbouring `theme` column: the set
-- of shipped languages is a frontend concern (see `src/app/core/i18n/locales.ts`),
-- and adding the 15th language must not require a database migration. The
-- server still validates against a list on write (`UpdatePreferencesDto`), and
-- `localeToWire` degrades an unrecognised stored value to English on read, so a
-- language that is later dropped cannot break `/me` for accounts that chose it.

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
