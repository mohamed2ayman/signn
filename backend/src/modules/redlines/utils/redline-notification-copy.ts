import { RedlineEmailLang } from './recipient-language.util';

/**
 * 7.19 Slice 4 — ALL redline notification copy, in ONE place, in both
 * languages.
 *
 * Why one module rather than strings inlined in the email template: a redline
 * event produces an in-app row (title + message) AND an email (subject + body)
 * that must say the same thing. Splitting the copy across the template registry
 * and the dispatch call site would let the two drift silently — and the in-app
 * row is frozen at write time (the `notifications` table has no language
 * column), so a drifted string is unrecoverable.
 *
 * The email TEMPLATE (templates/index.ts) is a dumb renderer over this copy;
 * the branded HTML shell stays in the template registry per convention.
 *
 * ⚠️ ARABIC COPY IS DRAFT — pending Youssef's legal-terminology review, the
 * same posture as `riskTab.*` and `clauseType.*`. The English is final.
 *
 * Numerals: counts interpolate as Latin digits (0-9) deliberately, including in
 * Arabic copy — the MENA construction-finance convention (lesson #137). Do NOT
 * route these through `Intl.NumberFormat('ar-EG', …)`.
 */

/** The four immediate events + the two digest flushes. */
export type RedlineNotificationVariant =
  | 'proposed'
  | 'accepted'
  /**
   * Accepted, but the host SUBSTITUTED different wording on the way in
   * (`AcceptRedlineDto.editedContent` → the clause is promoted with the host's
   * text and marked `ClauseReviewStatus.EDITED`).
   *
   * ⚠️ This variant is not cosmetic. The plain `accepted` copy asserts "the
   * proposed wording is now the live clause text" — which is FALSE when the
   * host edited, and this notification is the counterparty's only push signal
   * about the current text of a legal document. The service already treats the
   * distinction as material internally (`acceptSummary` writes "accepted with
   * host edits" into the version-history snapshot); the outward-facing copy
   * must not drop it.
   */
  | 'accepted_edited'
  | 'rejected'
  | 'countered'
  | 'digest_proposed'
  | 'digest_decided';

export interface RedlineCopyVars {
  /** Contract name — RAW here; the caller/template escapes at render time. */
  contractName: string;
  /**
   * Actor display name from the SHARED scrubbed projection
   * (redlineAuthorLabel) — never an email, role, or UUID. Absent on digests:
   * a digest deliberately does NOT enumerate cross-org author details.
   */
  actorName?: string;
  /** Clause reference (e.g. "§4.2 — Payment Terms"), when resolvable. */
  clauseRef?: string | null;
  /** Suppressed-event count, digests only. */
  count?: number;
}

export interface RedlineNotificationCopy {
  /** Email subject line. */
  subject: string;
  /** In-app notification title (notifications.title, varchar(500)). */
  inAppTitle: string;
  /** In-app notification message (notifications.message, text). */
  inAppMessage: string;
  /** Email H1. */
  heading: string;
  /** Email body paragraphs, in order. */
  body: string[];
  /** Email CTA button label. */
  cta: string;
  /** Email footer note. */
  note: string;
  /** Hidden inbox-preview line. */
  preheader: string;
  /** Label used by the clause info block; null when there is no clause ref. */
  clauseLabel: string;
}

const EN = {
  clauseLabel: 'Clause',
  contractLabel: 'Contract',
  cta: 'Open contract',
  note: 'Open the contract in Sign and go to the Redlines tab to respond.',
};

const AR = {
  clauseLabel: 'البند',
  contractLabel: 'العقد',
  cta: 'فتح العقد',
  note: 'افتح العقد في Sign وانتقل إلى تبويب التعديلات المقترحة للرد.',
};

/**
 * Resolve every string for one notification. Pure + total — an unknown variant
 * is impossible by the type, and missing optional vars degrade to a shorter
 * sentence rather than rendering "undefined".
 */
export function redlineNotificationCopy(
  lang: RedlineEmailLang,
  variant: RedlineNotificationVariant,
  vars: RedlineCopyVars,
): RedlineNotificationCopy {
  const contract = vars.contractName;
  const actor = vars.actorName ?? (lang === 'ar' ? 'أحد الأطراف' : 'A party');
  const count = vars.count ?? 0;
  const base = lang === 'ar' ? AR : EN;

  const shared = {
    cta: base.cta,
    note: base.note,
    clauseLabel: base.clauseLabel,
  };

  if (lang === 'ar') {
    switch (variant) {
      case 'proposed':
        return {
          ...shared,
          subject: `Sign — تعديل مقترح جديد على "${contract}"`,
          inAppTitle: 'تعديل مقترح جديد',
          inAppMessage: `اقترح ${actor} تعديلاً على بند في "${contract}".`,
          heading: 'تعديل مقترح جديد',
          body: [
            `اقترح ${actor} تعديلاً على بند في "${contract}".`,
            'راجع التعديل المقترح ثم اقبله أو ارفضه أو اقترح تعديلاً مقابلاً.',
          ],
          preheader: `تعديل مقترح جديد على "${contract}"`,
        };
      case 'accepted':
        return {
          ...shared,
          subject: `Sign — تم قبول تعديلك المقترح على "${contract}"`,
          inAppTitle: 'تم قبول تعديلك المقترح',
          inAppMessage: `قَبِل ${actor} تعديلك المقترح على "${contract}".`,
          heading: 'تم قبول تعديلك المقترح',
          body: [
            `قَبِل ${actor} تعديلك المقترح على "${contract}".`,
            'أصبح النص المقترح هو النص المعتمد للبند، وتم حفظ النسخة السابقة في سجل الإصدارات.',
          ],
          preheader: `تم قبول تعديلك المقترح على "${contract}"`,
        };
      case 'accepted_edited':
        return {
          ...shared,
          subject: `Sign — تم قبول تعديلك المقترح على "${contract}" مع تعديلات`,
          inAppTitle: 'تم قبول تعديلك المقترح مع تعديلات',
          inAppMessage: `قَبِل ${actor} تعديلك المقترح على "${contract}" بعد إدخال تعديلات على الصياغة.`,
          heading: 'تم قبول تعديلك المقترح مع تعديلات',
          body: [
            `قَبِل ${actor} تعديلك المقترح على "${contract}"، لكنه عدّل الصياغة قبل اعتمادها.`,
            'النص المعتمد للبند يختلف عن الصياغة التي اقترحتها — يُرجى فتح العقد لمراجعة النص النهائي.',
          ],
          preheader: `تم قبول تعديلك المقترح على "${contract}" مع تعديلات على الصياغة`,
        };
      case 'rejected':
        return {
          ...shared,
          subject: `Sign — تم رفض تعديلك المقترح على "${contract}"`,
          inAppTitle: 'تم رفض تعديلك المقترح',
          inAppMessage: `رفض ${actor} تعديلك المقترح على "${contract}".`,
          heading: 'تم رفض تعديلك المقترح',
          body: [
            `رفض ${actor} تعديلك المقترح على "${contract}".`,
            'لم يطرأ أي تغيير على نص البند.',
          ],
          preheader: `تم رفض تعديلك المقترح على "${contract}"`,
        };
      case 'countered':
        return {
          ...shared,
          subject: `Sign — تعديل مقابل على "${contract}"`,
          inAppTitle: 'تم اقتراح تعديل مقابل',
          inAppMessage: `اقترح ${actor} تعديلاً مقابلاً على "${contract}".`,
          heading: 'تم اقتراح تعديل مقابل',
          body: [
            `ردّ ${actor} على تعديلك المقترح على "${contract}" بتعديل مقابل.`,
            'راجع التعديل المقابل للمتابعة.',
          ],
          preheader: `تعديل مقابل على "${contract}"`,
        };
      case 'digest_proposed':
        return {
          ...shared,
          subject: `Sign — ${count} تعديلات مقترحة إضافية على "${contract}"`,
          inAppTitle: `${count} تعديلات مقترحة إضافية`,
          inAppMessage: `تم اقتراح ${count} تعديلات إضافية على "${contract}".`,
          heading: 'تعديلات مقترحة إضافية',
          body: [
            `تم اقتراح ${count} تعديلات إضافية على "${contract}" منذ آخر إشعار.`,
            'افتح العقد لمراجعتها جميعاً.',
          ],
          preheader: `${count} تعديلات مقترحة إضافية على "${contract}"`,
        };
      case 'digest_decided':
        return {
          ...shared,
          subject: `Sign — ${count} قرارات إضافية على تعديلاتك في "${contract}"`,
          inAppTitle: `${count} قرارات إضافية`,
          inAppMessage: `تم اتخاذ ${count} قرارات إضافية على تعديلاتك المقترحة في "${contract}".`,
          heading: 'قرارات إضافية على تعديلاتك المقترحة',
          body: [
            `تم اتخاذ ${count} قرارات إضافية على تعديلاتك المقترحة في "${contract}" منذ آخر إشعار.`,
            'افتح العقد لمراجعتها جميعاً.',
          ],
          preheader: `${count} قرارات إضافية على "${contract}"`,
        };
    }
  }

  switch (variant) {
    case 'proposed':
      return {
        ...shared,
        subject: `Sign — a change was proposed on "${contract}"`,
        inAppTitle: 'New change proposed',
        inAppMessage: `${actor} proposed a change to a clause in "${contract}".`,
        heading: 'New change proposed',
        body: [
          `${actor} proposed a change to a clause in "${contract}".`,
          'Review the proposed wording, then accept, reject, or counter it.',
        ],
        preheader: `A change was proposed on "${contract}"`,
      };
    case 'accepted':
      return {
        ...shared,
        subject: `Sign — your proposed change to "${contract}" was accepted`,
        inAppTitle: 'Your proposed change was accepted',
        inAppMessage: `${actor} accepted your proposed change to "${contract}".`,
        heading: 'Your proposed change was accepted',
        body: [
          `${actor} accepted your proposed change to "${contract}".`,
          'The proposed wording is now the live clause text, and the previous version was saved to version history.',
        ],
        preheader: `Your proposed change to "${contract}" was accepted`,
      };
    case 'accepted_edited':
      return {
        ...shared,
        subject: `Sign — your proposed change to "${contract}" was accepted with edits`,
        inAppTitle: 'Your proposed change was accepted with edits',
        inAppMessage: `${actor} accepted your proposed change to "${contract}", with edits to the wording.`,
        heading: 'Your proposed change was accepted with edits',
        body: [
          `${actor} accepted your proposed change to "${contract}", but modified the wording before it went live.`,
          'The live clause text differs from what you proposed — open the contract to review the final wording.',
        ],
        preheader: `Your proposed change to "${contract}" was accepted with edits`,
      };
    case 'rejected':
      return {
        ...shared,
        subject: `Sign — your proposed change to "${contract}" was rejected`,
        inAppTitle: 'Your proposed change was rejected',
        inAppMessage: `${actor} rejected your proposed change to "${contract}".`,
        heading: 'Your proposed change was rejected',
        body: [
          `${actor} rejected your proposed change to "${contract}".`,
          'The clause wording is unchanged.',
        ],
        preheader: `Your proposed change to "${contract}" was rejected`,
      };
    case 'countered':
      return {
        ...shared,
        subject: `Sign — a counter-proposal on "${contract}"`,
        inAppTitle: 'A counter-proposal was made',
        inAppMessage: `${actor} countered your proposed change to "${contract}".`,
        heading: 'A counter-proposal was made',
        body: [
          `${actor} responded to your proposed change to "${contract}" with a counter-proposal.`,
          'Review the counter-proposal to continue the negotiation.',
        ],
        preheader: `A counter-proposal on "${contract}"`,
      };
    case 'digest_proposed':
      return {
        ...shared,
        subject: `Sign — ${count} more changes proposed on "${contract}"`,
        inAppTitle: `${count} more changes proposed`,
        inAppMessage: `${count} more changes were proposed on "${contract}".`,
        heading: 'More changes proposed',
        body: [
          `${count} more changes were proposed on "${contract}" since the last notification.`,
          'Open the contract to review them together.',
        ],
        preheader: `${count} more changes proposed on "${contract}"`,
      };
    case 'digest_decided':
      return {
        ...shared,
        subject: `Sign — ${count} more decisions on your changes to "${contract}"`,
        inAppTitle: `${count} more decisions`,
        inAppMessage: `${count} more decisions were made on your proposed changes to "${contract}".`,
        heading: 'More decisions on your proposed changes',
        body: [
          `${count} more decisions were made on your proposed changes to "${contract}" since the last notification.`,
          'Open the contract to review them together.',
        ],
        preheader: `${count} more decisions on "${contract}"`,
      };
  }
}
