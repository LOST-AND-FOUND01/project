# FOUNDIT Frontend Upgrade — Development Log

## Overview
- **Approved Workspace:** `A:\lavanya`
- **Backup Created:** `A:\lavanya\backups\original-community` (untouched clone of `lavanyanagathan8/community`)
- **Upgraded Frontend:** `A:\lavanya\frontend\`
- **Preserved Design:** Cherry (`#C94655`), deep burgundy (`#7A2D43`), warm ivory (`#FFFAF8`), soft blush (`#F5D5D8`), `Georgia` hero display headings + `Arial` UI typography, `FOUNDIT.` branding, interactive isometric JCET campus map, smart location matches, two-party handover confirmation, and QR prefilled reporting links.

## Modular Architecture
- `styles/base.css` — Preserved theme tokens, layout, campus map, responsive breakpoints.
- `styles/components.css` — Styles for auth tabs, dashboard sub-tabs, claim timeline, notifications dropdown, drag-and-drop image upload, and floating AI assistant.
- `scripts/data/mockData.js` — Isolated seed data, campus zones, categories, statuses, demo users, notifications, announcements, audit logs, and suggested AI prompts.
- `scripts/utils/helpers.js` — HTML escaping (`safe`), validation, image reading (`< 700 KB`), toast, and modal helpers.
- `scripts/state/store.js` — LocalStorage-persisted state store (`foundit_frontend_upgraded_v3`), migrating any legacy `foundit_frontend_demo_v2` reports/claims.
- `scripts/components/*` — `navbar.js`, `itemCard.js`, `campusMap.js`, `aiAssistant.js`.
- `scripts/pages/*` — `homePage.js`, `browsePage.js`, `reportPage.js`, `authPage.js`, `studentDashboard.js`, `adminDashboard.js`.
- `scripts/main.js` — Hashless SPA router, URL `?location=` prefill, store subscription.

## Features Using Mock / Local Data (No Backend Yet)
1. **Student Authentication (`authPage.js`):** Login, Registration, Email Verification (simulated 6-digit OTP), Forgot Password, Reset Password, Logout — stored in `localStorage`.
2. **Student & Admin Dashboards (`studentDashboard.js`, `adminDashboard.js`):** Role switching and user directory use `DEMO_USERS` in `mockData.js`.
3. **Claims, Moderation & Audit Log (`store.js`):** Local state updates + in-browser audit trail.
4. **Notifications (`navbar.js`, `studentDashboard.js`):** Local notification feed + admin announcements.
5. **AI Assistant (`aiAssistant.js`):** Keyword-driven local mock responses querying current browser state; supports loading dots, simulated error/retry (`"simulate error"`), suggested questions, and clear chat.
