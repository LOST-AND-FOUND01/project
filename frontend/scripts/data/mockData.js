/* FOUNDIT — Shared Domain Constants & Phase-3 Mock AI Prompts
 * Functional app data (users, reports, claims, notifications, audit logs)
 * is stored in and retrieved from Supabase PostgreSQL & Storage.
 */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.MOCK_DATA = {
  CAMPUS_ZONES: [
    "Academic Block",
    "Library",
    "Computer Labs",
    "Canteen",
    "Auditorium",
    "Playground",
    "Parking Area"
  ],

  CATEGORIES: [
    "Electronics",
    "Accessories",
    "Documents",
    "Books",
    "Keys & ID Cards",
    "Other"
  ],

  STATUSES: [
    "Open",
    "Under Review",
    "Handover Pending",
    "Returned",
    "Archived"
  ],

  // Temporary mock assistant prompts (AI provider integration is deferred to Phase 3)
  AI_SUGGESTED_QUESTIONS: [
    "How do I report a lost item?",
    "How does claim verification work?",
    "Show open items in Library",
    "How does two-party handover work?",
    "What campus zones are supported?"
  ]
};
