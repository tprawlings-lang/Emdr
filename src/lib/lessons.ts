// Psychoeducation micro-lessons (roadmap F11). Short, trauma-informed lessons
// that build trust and give non-session days a purpose. Same shape as practices:
// code-defined content (reviewable in one place), only READ progress touches the
// DB, served identically to web + iOS.
//
// Content is educational, non-graphic, invitational, and makes no diagnostic or
// cure claims (roadmap §9 / COMPLIANCE). Drafts pending EMDR-advisor review
// before launch, consistent with Steady's content posture.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  readMinutes: number;
  tags: string[];
  /** Modules this lesson supports (surfaced from the module intro). */
  relatedModuleIds: string[];
  /** Markdown body. */
  body: string;
}

export const LESSONS: Lesson[] = [
  {
    id: "window-of-tolerance",
    title: "Your window of tolerance",
    summary: "The zone where you can feel and cope at the same time — and how it widens.",
    readMinutes: 3,
    tags: ["foundations", "regulation"],
    relatedModuleIds: ["calm-place", "containment", "body-scan"],
    body: `## The idea
Your **window of tolerance** is the zone where your nervous system can handle what you're feeling and still stay present. Inside it, emotions can be strong but workable.

## Outside the window
When something is too much, you can move **above** the window into *hyperarousal* — racing heart, panic, anger, feeling flooded. Or **below** it into *hypoarousal* — numb, shut down, foggy, far away. Both are the body doing its best to protect you. Neither is a failure.

## Why it matters here
Steady's work happens **inside** your window. That's why every session checks in first, keeps things paced, and stops if distress climbs. Widening the window — through grounding, breath, and your calm place — is the quiet groundwork that makes everything else possible.

## A small practice
Next time you notice you're drifting up or down, name it: *"I'm a little above my window right now."* Naming it is often the first step back toward the middle.`,
  },
  {
    id: "why-emdr-works",
    title: "Why the EMDR method works",
    summary: "How reprocessing lowers the charge of a stuck memory — without erasing it.",
    readMinutes: 4,
    tags: ["foundations", "method"],
    relatedModuleIds: ["calm-place", "resourcing", "recent-trigger"],
    body: `## Memories that stay "stuck"
After something overwhelming, a memory can get stored without being fully processed — so it still feels *present*, with the same images, body sensations, and beliefs, even years later.

## Bilateral stimulation
The EMDR method pairs bringing a memory gently to mind with **bilateral stimulation** — alternating left–right signals (tones, taps, or eye movements). Researchers think this occupies working memory and engages the brain's natural ability to *reprocess* — to file the memory as something that happened, rather than something happening now.

## What changes
The aim isn't to erase a memory. It's to lower its charge, so it becomes a part of your history you can recall without being pulled back into it.

## Steady's place in this
Steady is a **self-guided wellness program built on the EMDR method** — not therapy, and not a replacement for working with a trained clinician on hard trauma. It focuses on the **stabilization and resourcing** groundwork — widening your window — that makes any deeper work safer.`,
  },
  {
    id: "understanding-triggers",
    title: "Understanding triggers",
    summary: "Why the body reacts to the past as if it were now — and why that isn't weakness.",
    readMinutes: 3,
    tags: ["foundations", "triggers"],
    relatedModuleIds: ["trigger-map", "recent-trigger"],
    body: `## What a trigger is
A **trigger** is a cue in the present — a sound, smell, phrase, place, or feeling — that your nervous system links to something from the past, and reacts to as if the danger were happening *now*.

## It isn't weakness
A trigger reaction is fast, automatic, and below conscious control. It's a protection system doing its job, just miscalibrated to a threat that has passed. Noticing that can loosen the shame that often rides along with it.

## Mapping them
When you name your triggers — what sets it off, where you feel it, the belief that comes with it — you turn something formless into something you can work with. That's what Steady's trigger map is for.

## The gap
There's often a small gap between the cue and the reaction. Grounding and breath widen that gap, giving you a moment to *choose* a response instead of being carried by one.`,
  },
  {
    id: "grounding-nervous-system",
    title: "Grounding and your nervous system",
    summary: "How the senses tell an alarmed brain: right now, you are safe.",
    readMinutes: 3,
    tags: ["skills", "grounding"],
    relatedModuleIds: ["calm-place", "containment"],
    body: `## Why grounding helps
When you're activated, your attention narrows onto threat. **Grounding** does the opposite: it uses your senses to signal to your nervous system that *right now, you are safe*.

## Orienting
Slowly looking around the room — noticing colours, objects, the way out, today's date — is called **orienting**. It tells the ancient, danger-scanning parts of the brain: *checked, we're okay here.*

## The tools
- **5-4-3-2-1**: five things you see, four you hear, three you touch, two you smell, one you taste.
- **Feet on the floor**, pressing down.
- **Longer exhales** than inhales.
- Your **calm place** and your **cue word**.

## No wrong time
Grounding isn't only for crises. Using it lightly through the day keeps your window wider, so big waves have less far to pull you.`,
  },
  {
    id: "titration-dual-attention",
    title: "Small doses: titration & dual attention",
    summary: "Why short, paced contact — one foot in the present — is the work, not a detour.",
    readMinutes: 3,
    tags: ["method", "pacing"],
    relatedModuleIds: ["body-scan", "recent-trigger", "safe-target"],
    body: `## One foot in the present
Trauma work is safest when you keep **dual attention** — one foot in the memory, one foot firmly in the present. You're not diving in; you're looking *while* staying anchored here.

## Titration
**Titration** means working in small, tolerable doses rather than all at once. A little contact, then back to steady. This is why Steady's sets are short, why it checks your distress between them, and why it stops when things climb.

## Why "less" is often "more"
Flooding the system doesn't speed healing — it narrows your window. Small, repeated, tolerable contact is what lets the nervous system actually update. Slow is not a detour; slow *is* the work.`,
  },
  {
    id: "self-compassion",
    title: "Self-compassion in healing",
    summary: "Why warmth toward yourself isn't a reward for getting better — it's part of how you do.",
    readMinutes: 3,
    tags: ["mindset"],
    relatedModuleIds: ["resourcing", "calm-place"],
    body: `## The inner critic
Many people carry a harsh inner voice — *I should be over this; what's wrong with me.* That voice is often an old survival strategy, but it keeps the nervous system braced.

## Three parts
Self-compassion isn't letting yourself off the hook. It's three things: **mindfulness** (naming that this is hard), **common humanity** (you're not alone or broken), and **kindness** (speaking to yourself as you would to someone you love).

## Why it helps the work
A braced, self-critical system stays outside its window. Warmth and safety are the conditions healing actually needs. Being kinder to yourself isn't a reward for getting better — it's part of *how* you get better.

## A small shift
When the critic shows up, try: *"This is a hard moment. Hard moments are part of being human. May I be gentle with myself right now."*`,
  },
  {
    id: "building-a-calm-place",
    title: "Building a calm place",
    summary: "How a vivid inner anchor teaches your body a reliable off-ramp from activation.",
    readMinutes: 3,
    tags: ["skills", "resourcing"],
    relatedModuleIds: ["calm-place", "resourcing"],
    body: `## A resource you can return to
A **calm or safe place** is a mental anchor — a real or imagined spot where your body feels settled. Building one, and pairing it with slow bilateral stimulation, is a core resourcing skill.

## Why it's real
When you vividly bring a calm place to mind — what you see, hear, the temperature, the light — your nervous system responds *as if* you were partly there. You're teaching your body a dependable off-ramp from activation.

## Your cue word
Choosing a single word for the place — *shore, pines, kitchen* — gives you a shortcut. In time, the word alone can begin to bring the settled feeling back.

## If it turns unpleasant
Sometimes a "safe" place doesn't feel safe to every part of you. That's information, not failure — and Steady never pushes a resource that stops feeling good. You can always choose another.`,
  },
];

export function getLesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function lessonsForModule(moduleId: string): Lesson[] {
  return LESSONS.filter((l) => l.relatedModuleIds.includes(moduleId));
}

/** Ids of lessons the member has marked read. */
export async function readLessonIds(userId: string): Promise<string[]> {
  const c = await data();
  const rows = (await c.all("SELECT lesson_id FROM lesson_reads WHERE user_id = ?", [userId])) as Array<{
    lesson_id: string;
  }>;
  return rows.map((r) => r.lesson_id);
}

/** Mark a lesson read (idempotent per user+lesson). */
export async function markLessonRead(userId: string, lessonId: string): Promise<{ ok: boolean }> {
  const lesson = getLesson(lessonId);
  if (!lesson) return { ok: false };
  const c = await data();
  await c.run(
    `INSERT INTO lesson_reads (id, user_id, lesson_id) VALUES (?, ?, ?)
     ON CONFLICT(user_id, lesson_id) DO NOTHING`,
    [newId(), userId, lesson.id]
  );
  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "lesson_read", target: lesson.id, detail: {},
  });
  return { ok: true };
}
