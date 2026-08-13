# OROK Restart Brief
Prepared: 10 August 2026
## Project address
- Canonical GitHub repository: https://github.com/oroknows-arch1/orok-studios-mvp
- Canonical product: the original OROK app (`orok-studios-mvp`)
- Publishing belongs inside the original app. Do not revive or build a separate publishing app.
- Publishing screen route: `/#today`
- Legacy `/publishing` route redirects to `/#today`.
The exact public Render URL is not preserved in the available project record and must be copied from the Render service dashboard before work resumes.
## What OROK is
OROK means **Our Roots. Our Knowledge.** It is a calm, grounded digital production system that turns observations into structured content, imagery and publishing workflows.
Core voice: calm, observational, culturally aware, blue-collar relatable.
Core line: **No noise. Just structure.**
## Confirmed foundation
- Node 22 / Express 5 application.
- Backend entry point: `server.js`.
- Frontend shell: `index.html`, `app.js`, `style.css`.
- Core routes: `POST /generate`, `POST /generate-image`, `POST /analyze-voice`, `GET /health`.
- Postgres publishing repository with migrations 001–004.
- Publishing API and UI integrated into the original application.
- Today, Ledger and Review workflow.
- Draft save, review, approve and manual publish-record flow.
- Weekly content categories and scheduler logic.
- Long Game content engine and source metadata.
- Thursday Masters of Yesterday rotation and Lingo attachment flow.
- Pull requests #4–#6 covered Long Game, consolidation, Thursday rotation and Lingo; PR #7 addressed image prompting.
## Canonical weekly system
| Day | Stream | Required input / rule |
| --- | --- | --- |
| Monday | Motivation Monday | User supplies a word or short theme |
| Tuesday | Masters of Today | Modern tribute; generated image OFF; user supplies tribute image |
| Wednesday | Words of Wisdom | User supplies a word or short theme |
| Thursday | Masters of Yesterday + Lingo | Cultural rotation plus a random *Learn Cook Island Māori* episode |
| Friday | Friday Recap | Weekly reflection and synthesis |
| Saturday | Mixed | Mixed-category post |
| Sunday | Long Game | Financial brief; clickable sources allowed |
Thursday rotation is anchored to 1 January 2026 and advances by calendar Thursday:
1. Indigenous Australia
2. Cook Islands
3. Aotearoa New Zealand
4. Peru
Missed weeks do not shift the rotation.
## Publishing rules
- Drafts must appear in the app, not only in chat.
- Daily X publishing window: 3:00–6:00 pm Australia/Sydney.
- Monday and Wednesday generation must wait for the user's theme.
- X copy: maximum 280 characters, exactly three hashtags and an attached image where enabled.
- Long Game is the only stream where clickable source links are approved.
- A real X API result should confirm whether scheduled publishing succeeded.
## Image-system position
The saved specification is OROK Image System V3.2 with four lenses:
- Everyday: behaviour is the hero.
- Heritage: culture is the hero.
- Legacy: contribution is the hero.
- Recap: connection is the hero.
The fixed qualities remain documentary realism, natural everyday behaviour, no fantasy, no text, no labels, no watermarks, no symbolic props and no invented cultural detail.
However, the saved V3.2 file still prescribes a four-panel collage. That later produced rejected results. Therefore the image system is **not signed off** until the repository prompt, the selection-time `buildImagePrompt` behaviour and the latest intended visual direction are tested together.
## Known deployment risk
The Render deployment previously reported `relation publishing_items does not exist` because migrations were not automatically run. The migration command is:
```bash
npm run db:migrate
```
It needs `DATABASE_URL`. Render's free tier did not provide the desired pre-deploy command, so the migration must be run through an available Render shell/job or another controlled environment with the production database URL. The command is intended to be idempotent.
## What remains before OROK is totally finished
1. Verify the current repository branch, merged PRs and clean deployment state.
2. Recover and test the live Render address.
3. Confirm production database migrations 001–004 are applied.
4. Run the existing test suite and record the true current pass count.
5. Test one complete week in the app: theme input, generation, image decision, approval, scheduling and ledger record.
6. Repair and sign off the image system using representative Everyday, Heritage, Legacy and Recap posts.
7. Confirm Tuesday generated images are disabled.
8. Confirm Sunday source links remain clickable and other streams reject links.
9. Connect and verify X API publishing receipts, including failure handling.
10. Complete final mobile and desktop usability checks, then freeze a release candidate.
## First session back: orientation only
Do not begin by adding features. Use the first session to establish the truth of the current build.
1. Open the GitHub repository.
2. Open the Render service and copy the exact public URL.
3. Record the active branch and latest commit.
4. Check environment variables without copying secret values: `OPENAI_API_KEY`, `DATABASE_URL` and any X API variables.
5. Open the live app at `/#today`.
6. Check `/health`.
7. Confirm whether publishing tables exist.
8. Run tests.
9. Generate one Monday draft with a test theme, but do not publish it.
10. Record every failure before changing code.
### Exit condition for Session 1
Finish with a short evidence list containing:
- live URL;
- branch and commit;
- deployment health;
- database migration status;
- test result;
- first broken step in the end-to-end workflow.
That evidence determines the first coding task. The likely first task is deployment/database stabilisation; the image-system correction follows once the base workflow is dependable.
## Definition of done
OROK is finished when a complete weekly schedule can be prepared inside the original app, reviewed, imaged according to the approved lens rules, scheduled for the correct Sydney window, published through X with a recorded success/failure receipt, and reviewed later in the Ledger without manual reconstruction.
