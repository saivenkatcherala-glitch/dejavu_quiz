# DejaVu — Online Proctored Team Quiz

A production-ready online proctored quiz platform for college events, supporting ~200 simultaneous teams.

## Quick Start

### 1. Prerequisites
- Node.js 18+
- A Supabase project (with existing team registration data)

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your Supabase credentials:
# VITE_SUPABASE_URL=https://your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Set Up Database
Run the SQL migrations in your Supabase SQL Editor **in order**:

1. `supabase/migrations/001_quiz_tables.sql` — Creates all quiz tables, RLS policies, functions
2. `supabase/migrations/002_seed_data.sql` — Inserts dummy teams and questions (adjust if your teams table has different column names)

### 4. Create Admin User
In Supabase Dashboard → Authentication → Users, create a new user with email/password. This will be your admin account.

### 5. Run the App
```bash
npm install
npm run dev
```

- **Quiz Login**: http://localhost:5173/quiz/login
- **Admin Login**: http://localhost:5173/admin/login

---

## Architecture

```
src/
├── components/
│   ├── admin/AdminLayout.tsx    # Admin sidebar layout
│   └── ui.tsx                   # Reusable UI components
├── contexts/
│   ├── AdminAuthContext.tsx      # Supabase Auth for admin
│   └── TeamSessionContext.tsx    # Team session management
├── hooks/
│   └── useProctoring.ts         # Proctoring hook (camera, tabs, etc.)
├── lib/
│   ├── supabase.ts              # Supabase client
│   ├── types.ts                 # TypeScript types
│   └── utils.ts                 # Utilities
├── pages/
│   ├── admin/
│   │   ├── AdminLogin.tsx       # /admin/login
│   │   ├── Dashboard.tsx        # /admin
│   │   ├── TeamsPage.tsx        # /admin/teams
│   │   ├── QuestionsPage.tsx    # /admin/questions
│   │   ├── QuizControlPage.tsx  # /admin/quiz-control
│   │   ├── AttemptsPage.tsx     # /admin/attempts
│   │   ├── ViolationsPage.tsx   # /admin/violations
│   │   ├── LiveMonitorPage.tsx  # /admin/live
│   │   ├── ResultsPage.tsx      # /admin/results
│   │   └── ActivityLogPage.tsx  # /admin/activity
│   └── quiz/
│       ├── QuizLogin.tsx        # /quiz/login
│       ├── SystemCheck.tsx      # /quiz/check
│       ├── Instructions.tsx     # /quiz/instructions
│       ├── QuizPage.tsx         # /quiz
│       └── QuizResult.tsx       # /quiz/result
├── App.tsx                      # Router + providers
└── main.tsx                     # Entry point

supabase/
└── migrations/
    ├── 001_quiz_tables.sql      # Tables, RLS, functions
    └── 002_seed_data.sql        # Seed data
```

## Connecting to Your Existing Registration Database

The app expects a `teams` table with at minimum:
- `team_id` (TEXT, primary key)
- `team_name` (TEXT)
- `status` (TEXT — 'registered', 'verified', etc.)

If your existing table has different column names, update the queries in:
- `src/pages/quiz/QuizLogin.tsx` (team lookup)
- `src/pages/admin/TeamsPage.tsx` (team listing)
- `src/pages/admin/Dashboard.tsx` (team count)
- `supabase/migrations/002_seed_data.sql` (seed data)

## Key Features

### Participant Flow
1. Enter Team ID → verified against registration data
2. System check (camera, fullscreen, network)
3. Read instructions → Start quiz
4. Answer questions with auto-save
5. Server-side scoring on submission
6. View result

### Admin Features
- **Dashboard**: Live stats, team counts, scores
- **Teams**: Search, grant/change attempts, disable/enable
- **Questions**: Add/edit/delete, CSV import with validation
- **Quiz Control**: Create, configure, start/pause/close
- **Live Monitor**: Real-time participant status
- **Violations**: Grouped by team with chronological timeline
- **Results**: Sortable table with CSV export
- **Activity Log**: Complete admin action history

### Security
- Supabase RLS on all tables
- Server-side scoring (SQL function)
- Correct answers never sent to browser
- Server-authoritative timer (expires_at)
- Session tokens for multi-device protection
- Admin routes protected by Supabase Auth

### Proctoring
- Camera monitoring (black frame / frozen detection)
- Tab switch / visibility change detection
- Fullscreen exit detection
- Window blur detection
- Copy/paste/right-click prevention
- Network disconnect tracking
- All events debounced (5s cooldown per type)
