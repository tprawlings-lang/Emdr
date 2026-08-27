// Practices — the shared "Prepare & Regulate" content service (roadmap §8).
// One content pattern serves meditation / movement / breathwork / sleep /
// soundscape to BOTH web and iOS: the backend defines practices, clients render
// them, and completions post back (feeding history, the daily plan, streaks, and
// companion memory). This first slice ships BREATHWORK, whose patterns are
// deterministic data (no produced media), so it needs no content pipeline.
//
// Definitions are code-defined (like MODULES / INSTRUMENTS) — reviewable in one
// place; only COMPLETIONS touch the DB. Trauma-safety (roadmap §9) is enforced
// here: no-breath-hold variants exist, holds are flagged, and titration surfaces
// gentler patterns first when today's check-in shows elevated dissociation.

import { data } from "./data";
import { newId } from "./db";
import { audit } from "./audit";
import { getTodayCheckin } from "./gating";
import { writeMemory } from "./companion";
import { recordInterventionCompleted } from "./spine";

export type PracticeType = "breathwork" | "meditation" | "movement" | "sleep" | "soundscape";

export interface BreathPhase {
  label: "inhale" | "hold" | "exhale" | "rest";
  seconds: number;
}

/** One spoken/shown beat of a guided meditation. `seconds` is how long the beat
 *  stays on screen (and the pause after it's read aloud) before the next. */
export interface MeditationSegment {
  text: string;
  seconds: number;
}

export interface Practice {
  id: string;
  type: PracticeType;
  title: string;
  intro: string;
  /** Suggested total length. Breathwork loops its phases to about this long. */
  durationSec: number;
  /** 1 = gentlest / most orienting, 3 = most activating. */
  intensity: 1 | 2 | 3;
  tags: string[];
  /** Breathwork: one cycle of phases (looped). Absent for other types. */
  phases?: BreathPhase[];
  /** Meditation: the guided script, beat by beat. Absent for other types. */
  segments?: MeditationSegment[];
  /** True if the pattern includes a breath hold (titrated / avoidable). */
  hasHold: boolean;
  /** Short usage/safety note shown with the practice. */
  note?: string;
}

// ── Breathwork catalog (deterministic; no media). Ordered gentlest-first. ──
export const BREATHWORK: Practice[] = [
  {
    id: "coherent-5-5", type: "breathwork", title: "Coherent breathing",
    intro: "A smooth, even breath — about five and a half seconds in, five and a half out. No holding.",
    durationSec: 120, intensity: 1, tags: ["calming", "orienting", "anytime"], hasHold: false,
    phases: [{ label: "inhale", seconds: 5.5 }, { label: "exhale", seconds: 5.5 }],
    note: "Even and easy. If counting feels like too much, just let the breath slow.",
  },
  {
    id: "extended-exhale", type: "breathwork", title: "Longer exhale",
    intro: "Breathe in for four, out for six. A longer exhale gently settles the nervous system.",
    durationSec: 90, intensity: 1, tags: ["calming", "grounding", "no-hold"], hasHold: false,
    phases: [{ label: "inhale", seconds: 4 }, { label: "exhale", seconds: 6 }],
    note: "No breath-holding. Good when you feel activated.",
  },
  {
    id: "physiological-sigh", type: "breathwork", title: "Physiological sigh",
    intro: "Two breaths in through the nose — a full breath, then a small top-up — and a long breath out.",
    durationSec: 60, intensity: 1, tags: ["reset", "quick", "no-hold"], hasHold: false,
    phases: [{ label: "inhale", seconds: 2 }, { label: "inhale", seconds: 1 }, { label: "exhale", seconds: 6 }],
    note: "A fast reset for a spike of stress. No holding.",
  },
  {
    id: "box-4", type: "breathwork", title: "Box breathing",
    intro: "Equal counts of four: in, hold, out, hold. A steady, contained rhythm.",
    durationSec: 120, intensity: 2, tags: ["focus", "steadying"], hasHold: true,
    phases: [
      { label: "inhale", seconds: 4 }, { label: "hold", seconds: 4 },
      { label: "exhale", seconds: 4 }, { label: "hold", seconds: 4 },
    ],
    note: "Includes gentle breath holds. Skip to a no-hold pattern if holding feels uneasy.",
  },
  {
    id: "four-seven-eight", type: "breathwork", title: "4-7-8 breath",
    intro: "In for four, hold for seven, out for eight. A slower pattern often used for winding down.",
    durationSec: 114, intensity: 2, tags: ["sleep", "wind-down"], hasHold: true,
    phases: [{ label: "inhale", seconds: 4 }, { label: "hold", seconds: 7 }, { label: "exhale", seconds: 8 }],
    note: "Longer holds — best sitting or lying down. If you feel light-headed, return to normal breathing.",
  },
];

// ── Meditation catalog (roadmap F2). Trauma-informed and deterministic: each
// is a short spoken script (no produced media, so no content pipeline), read
// aloud on-device or followed as text. Safety is built into the copy —
// orienting/present-moment work first, eyes-open options, and explicit
// permission to stop or skip. Ordered gentlest-first. ──
export const MEDITATIONS: Practice[] = [
  {
    id: "orienting-to-now", type: "meditation", title: "Orienting to now",
    intro: "A brief, eyes-open practice to arrive in the present and remind your body you're here, and it's now.",
    durationSec: 117, intensity: 1, tags: ["grounding", "present-moment", "eyes-open"], hasHold: false,
    note: "Keep your eyes open the whole time. This is about noticing the room you're actually in.",
    segments: [
      { text: "Let's take a couple of minutes to arrive. You don't need to change anything — just notice.", seconds: 9 },
      { text: "Let your eyes stay open. Slowly look around the space you're in.", seconds: 9 },
      { text: "Find something to your left. Now something to your right. You're turning your head, orienting, like any creature checking it's safe.", seconds: 14 },
      { text: "Name, silently, five things you can see. Take your time with each one.", seconds: 18 },
      { text: "Now notice four things you can hear — near, or far away.", seconds: 15 },
      { text: "Feel three points where your body is supported — your feet, the chair, your back.", seconds: 14 },
      { text: "Press your feet gently into the floor. The ground is holding you up.", seconds: 12 },
      { text: "Notice: you are here. It is now. Whatever else is true, this moment is a place you can stand.", seconds: 14 },
      { text: "Take one slower breath out. When you're ready, carry this noticing with you.", seconds: 12 },
    ],
  },
  {
    id: "breath-anchor", type: "meditation", title: "The breath as an anchor",
    intro: "Rest your attention on the breath — not to control it, just to have somewhere steady to return.",
    durationSec: 162, intensity: 1, tags: ["calming", "focus", "anytime"], hasHold: false,
    note: "There's no right way to breathe here. If watching the breath feels uneasy, open your eyes and feel your feet instead.",
    segments: [
      { text: "Settle into a position that feels okay. You can close your eyes, or keep a soft gaze downward.", seconds: 12 },
      { text: "You don't need to breathe in any special way. Just let the breath be as it is.", seconds: 12 },
      { text: "Notice where you feel it most — the nose, the chest, or the belly rising and falling.", seconds: 16 },
      { text: "Rest your attention there, lightly. Like a hand resting on something that moves.", seconds: 16 },
      { text: "When your mind wanders — and it will — that's fine. That's what minds do.", seconds: 14 },
      { text: "Each time you notice you've drifted, gently come back to the next breath. That returning is the practice.", seconds: 18 },
      { text: "There's nothing to achieve. Just this breath, and then the next one.", seconds: 16 },
      { text: "If anything feels like too much, open your eyes, look around, and press your feet down.", seconds: 14 },
      { text: "Stay with the breath for a few more moments, at your own pace.", seconds: 30 },
      { text: "When you're ready, let your attention widen back out to the room. You can return here any time.", seconds: 14 },
    ],
  },
  {
    id: "calm-place", type: "meditation", title: "A place of calm",
    intro: "Bring to mind a place — real or imagined — where you feel calm and safe, and let your senses fill it in.",
    durationSec: 170, intensity: 1, tags: ["resourcing", "calming", "visualization"], hasHold: false,
    note: "If no place feels safe, that's okay — imagine one, or picture a color or a texture that feels calm. You're always in control here.",
    segments: [
      { text: "Bring to mind a place where you feel calm and at ease. It can be real, remembered, or completely imagined.", seconds: 16 },
      { text: "It might be a beach, a forest, a room, a garden — or nowhere in particular, just a feeling of calm.", seconds: 14 },
      { text: "Look around this place. What do you see? Notice the colors, the light, the shapes.", seconds: 18 },
      { text: "What sounds are here? Maybe water, wind, birdsong — or a deep quiet.", seconds: 16 },
      { text: "Notice the temperature. The air on your skin. Is it warm, cool, still, moving?", seconds: 16 },
      { text: "Let yourself feel what it's like to be here — the ease of it, the safety of it.", seconds: 18 },
      { text: "This place is yours. It's always available to you, exactly like this.", seconds: 14 },
      { text: "If you'd like, choose a word for this place — a word you can say to yourself to come back.", seconds: 16 },
      { text: "Rest here a little longer. Let the calm settle into your body.", seconds: 28 },
      { text: "When you're ready, let the image soften, knowing you can return whenever you need to.", seconds: 14 },
    ],
  },
  {
    id: "self-compassion", type: "meditation", title: "A kinder moment",
    intro: "A short self-compassion practice — meeting yourself, and this moment, with a little more warmth.",
    durationSec: 156, intensity: 2, tags: ["self-compassion", "soothing"], hasHold: false,
    note: "If a hand on the heart feels like too much, rest it on your arm, or just imagine the warmth. Go at your own pace.",
    segments: [
      { text: "Let's take a few moments to turn some kindness toward yourself — something we rarely stop to do.", seconds: 12 },
      { text: "If it feels okay, place a hand somewhere comforting — your heart, your belly, or your other arm.", seconds: 14 },
      { text: "Feel the warmth and the gentle weight of your own hand. A simple signal of care.", seconds: 16 },
      { text: "Acknowledge, silently: this is a hard moment. Hard moments are part of being human.", seconds: 16 },
      { text: "You're not the only one who struggles. Everyone, everywhere, carries something.", seconds: 16 },
      { text: "Now offer yourself a few kind words. Maybe: may I be gentle with myself.", seconds: 16 },
      { text: "Or: may I give myself the care I need. Choose whatever words feel right to you.", seconds: 16 },
      { text: "You don't have to feel any particular way. The offering itself is enough.", seconds: 14 },
      { text: "Stay with the warmth of your hand for a few more breaths.", seconds: 24 },
      { text: "When you're ready, let your hand rest. You can be this kind to yourself any time.", seconds: 12 },
    ],
  },
  {
    id: "gentle-body-scan", type: "meditation", title: "Gentle body scan",
    intro: "Move your attention slowly through the body — with full permission to skip anywhere that doesn't feel okay.",
    durationSec: 162, intensity: 2, tags: ["body-awareness", "grounding"], hasHold: false,
    note: "You're in charge of your attention. Skip any area that feels uncomfortable, and keep your eyes open if that helps you feel safer.",
    segments: [
      { text: "We'll move attention gently through the body. If any area feels uncomfortable, simply skip it — that's not just allowed, it's wise.", seconds: 16 },
      { text: "Start with your feet. Notice any sensation — pressure, warmth, tingling, or nothing much at all.", seconds: 16 },
      { text: "Let your attention move up to your lower legs and knees. Just noticing, not changing.", seconds: 16 },
      { text: "Up through the hips and the base of the spine — the parts of you in contact with what's holding you.", seconds: 16 },
      { text: "Notice your belly and chest, rising and falling with the breath.", seconds: 16 },
      { text: "Your hands and arms. Maybe heavy, maybe light. However they are is fine.", seconds: 16 },
      { text: "Your shoulders and neck. If they're holding tension, you don't have to fix it — just notice it's there.", seconds: 16 },
      { text: "And your face — the jaw, around the eyes. Letting it be soft if it wants to be.", seconds: 16 },
      { text: "Now sense the whole body at once, here, breathing, supported.", seconds: 18 },
      { text: "If you skipped anywhere, that was you taking care of yourself. When you're ready, open your eyes and look around.", seconds: 16 },
    ],
  },
  {
    id: "container", type: "meditation", title: "Setting it aside",
    intro: "A containment practice: gently set difficult thoughts or feelings aside for now — not gone, just kept safe until you choose to return.",
    durationSec: 156, intensity: 2, tags: ["resourcing", "containment", "before-sleep"], hasHold: false,
    note: "This isn't about pushing feelings away for good — it's about choosing when to carry them. You decide what goes in, and when to open it again.",
    segments: [
      { text: "Sometimes we need to set something down for a while — not to avoid it, but to rest. Let's practice that.", seconds: 14 },
      { text: "Imagine a container. Any size, any material — a box, a chest, a vault, a jar with a lid.", seconds: 16 },
      { text: "Make it strong enough to hold whatever you need it to, and give it a lid or a door that only you control.", seconds: 18 },
      { text: "Now, if there's a worry or a feeling that's heavy right now, picture placing it inside.", seconds: 16 },
      { text: "You're not throwing it away. You're keeping it safe, setting it down until you're ready.", seconds: 16 },
      { text: "Close the container. Notice that it holds. The contents are secure, and they'll be there when you choose to return.", seconds: 18 },
      { text: "Feel what it's like to set it down, even a little. Your hands, and your mind, are freer for now.", seconds: 16 },
      { text: "The container waits for you. You decide if and when to open it — perhaps with support.", seconds: 16 },
      { text: "Take a slower breath. Notice the room around you.", seconds: 14 },
      { text: "When you're ready, carry on with your day, knowing what's set aside is safely kept.", seconds: 12 },
    ],
  },
];

// ── Sleep catalog (roadmap F5). Guided wind-down scripts to do lying down, in
// the dark, drifting off — slower pacing and longer pauses than a daytime
// meditation, and deliberately no "return to the room" ending: each trails off
// into permission to sleep. Deterministic text (no media). Ordered gentlest-
// first. Reuses the meditation segment player. ──
export const SLEEP: Practice[] = [
  {
    id: "wind-down-breath", type: "sleep", title: "Winding down",
    intro: "A slow, unhurried breath to let the day loosen its grip and the body grow heavy. Do this lying down.",
    durationSec: 206, intensity: 1, tags: ["wind-down", "breath", "in-bed"], hasHold: false,
    note: "Lie down, dim the screen, and let your eyes close whenever they want to. It's completely fine to fall asleep before the end.",
    segments: [
      { text: "Let yourself get comfortable. Feel the weight of your body sinking into the bed.", seconds: 18 },
      { text: "There's nothing to do now, and nowhere to be. This time is just for resting.", seconds: 18 },
      { text: "Let your breathing slow, all on its own. No counting, no effort.", seconds: 18 },
      { text: "Notice the out-breath — how it lets go. Let each one be a little longer, a little softer.", seconds: 22 },
      { text: "With every breath out, let something loosen — your shoulders, your jaw, your hands.", seconds: 24 },
      { text: "The day is behind you now. You don't have to hold any of it.", seconds: 22 },
      { text: "Just this breath. And the heaviness of the body. And the quiet.", seconds: 26 },
      { text: "Let the breaths get slower still. There's no need to stay awake for the end.", seconds: 28 },
      { text: "Sinking, softening, drifting. Let sleep come whenever it's ready.", seconds: 30 },
    ],
  },
  {
    id: "sleep-body-scan", type: "sleep", title: "Melting into rest",
    intro: "A slow, drowsy journey through the body, releasing each part in turn — a gentle way to let go of the day.",
    durationSec: 248, intensity: 1, tags: ["body-scan", "relaxation", "in-bed"], hasHold: false,
    note: "Do this lying down with the lights off. If any area feels uncomfortable, simply skip it. Drifting off partway through is exactly right.",
    segments: [
      { text: "Settle onto your back, or however you sleep. Let the bed take your full weight.", seconds: 20 },
      { text: "Bring a soft attention to your feet. Let them grow heavy, and warm, and still.", seconds: 24 },
      { text: "Let that heaviness spread up through your lower legs, and your knees. Nothing to hold.", seconds: 24 },
      { text: "Your thighs, your hips, sinking down into the mattress. Releasing.", seconds: 24 },
      { text: "Let your belly soften with each breath. Your back, resting fully into what holds you.", seconds: 26 },
      { text: "Your hands, your arms, growing heavy and warm. Let them be completely still.", seconds: 24 },
      { text: "Let your shoulders drop away from your ears. Your neck, long and soft.", seconds: 24 },
      { text: "Soften your jaw, and the space around your eyes. Let your whole face be at ease.", seconds: 24 },
      { text: "The whole body now, heavy and warm and still, held by the bed.", seconds: 28 },
      { text: "There's nothing left to do. Let yourself sink, and let sleep find you.", seconds: 30 },
    ],
  },
  {
    id: "put-the-day-down", type: "sleep", title: "Putting the day down",
    intro: "If a busy mind is keeping you awake, this gently sets the day and its worries aside — safe, and waiting, until morning.",
    durationSec: 222, intensity: 2, tags: ["worry", "containment", "in-bed"], hasHold: false,
    note: "For nights when your thoughts won't settle. You're not solving anything now — just setting it down until you're rested enough to hold it.",
    segments: [
      { text: "If your mind is still busy, that's okay. We're going to gently set the day down for the night.", seconds: 20 },
      { text: "Picture a place beside your bed to leave things — a table, a shelf, a basket.", seconds: 22 },
      { text: "Whatever your mind keeps reaching for — a worry, a task, a conversation — imagine setting it there.", seconds: 24 },
      { text: "You're not forgetting it. It will be right there in the morning, when you're rested.", seconds: 24 },
      { text: "One by one, lift each thought and set it down. There's nothing you must solve tonight.", seconds: 26 },
      { text: "If a new one arrives, that's fine — just set it down too, as many times as it takes.", seconds: 26 },
      { text: "Night is not the time for carrying. It's the time for putting down.", seconds: 24 },
      { text: "Feel how much lighter it is to rest with empty hands.", seconds: 26 },
      { text: "The day is set down. It's kept safe. Let your mind grow quiet, and let yourself drift.", seconds: 30 },
    ],
  },
  {
    id: "safe-and-warm", type: "sleep", title: "Safe and warm",
    intro: "A cocoon of imagined warmth and safety to sink into — soothing when the body needs to feel protected before sleep.",
    durationSec: 204, intensity: 1, tags: ["safety", "imagery", "in-bed"], hasHold: false,
    note: "Rest into the sense of being held and safe. If picturing a place feels like too much, just feel the warmth and weight of your own blankets.",
    segments: [
      { text: "Feel the weight of the blankets over you, the softness beneath you. You are held.", seconds: 22 },
      { text: "Imagine a warmth, like sunlight or a gentle glow, resting over your whole body.", seconds: 24 },
      { text: "Picture yourself somewhere completely safe — a place where nothing is asked of you.", seconds: 24 },
      { text: "It might be this bed, a cabin, a nest of blankets — anywhere you feel protected.", seconds: 24 },
      { text: "Nothing can reach you here. There is nothing to guard against, nothing to watch for.", seconds: 26 },
      { text: "Let your body understand that it's safe now. It can finally, fully rest.", seconds: 26 },
      { text: "Warm, and heavy, and safe. Held by the dark like something precious.", seconds: 28 },
      { text: "Let the warmth carry you down, gently, toward sleep.", seconds: 30 },
    ],
  },
];

// ── Movement catalog (roadmap F1). Gentle, trauma-informed movement done to a
// spoken script — orienting turns, discharging held stress ("shaking it off"),
// grounding stances, easy stretches, and proprioceptive pressing for a sense of
// containment. This slice is deliberately the form-free subset (nothing that
// needs demonstrated technique), so it ships as deterministic text like the
// other practices — no video pipeline. Reuses the segment player. Ordered
// gentlest-first. ──
export const MOVEMENT: Practice[] = [
  {
    id: "orienting-turns", type: "movement", title: "Orienting turns",
    intro: "Slow head and neck turns that let your body take in the room and register that you're safe. Seated or standing.",
    durationSec: 120, intensity: 1, tags: ["orienting", "grounding", "seated-option"], hasHold: false,
    note: "Move only as far as feels easy — never into pain. Do it seated if that's more comfortable, and skip anything that doesn't feel right.",
    segments: [
      { text: "Let's do a few slow, gentle movements to help your body feel settled. Move only as far as feels comfortable — and skip anything that doesn't.", seconds: 12 },
      { text: "Sit or stand, whichever you prefer. Let your shoulders drop.", seconds: 10 },
      { text: "Slowly turn your head to look over your right shoulder — just far enough to feel an easy stretch.", seconds: 14 },
      { text: "Come back to center, and slowly turn to look over your left shoulder.", seconds: 14 },
      { text: "Let your gaze travel around the room as you turn — noticing you're safe, taking in where you are.", seconds: 14 },
      { text: "Bring your head back to center. Let your chin drop gently toward your chest, and roll it slowly side to side.", seconds: 16 },
      { text: "Lift your head back up. Notice how your neck feels a little freer.", seconds: 12 },
      { text: "One more slow look to each side, at your own pace.", seconds: 16 },
      { text: "Come back to center. Your body has oriented — it knows where it is, and that it's okay.", seconds: 12 },
    ],
  },
  {
    id: "grounding-stance", type: "movement", title: "Rooting down",
    intro: "Find your feet and your steadiness — a short practice to feel solid and grounded when things feel shaky.",
    durationSec: 106, intensity: 1, tags: ["grounding", "steadying", "seated-option"], hasHold: false,
    note: "Do it seated or standing. If you sway, keep it small and stay in control — the point is to feel steady, not to challenge your balance.",
    segments: [
      { text: "This is a grounding practice to help you feel steady and rooted. You can do it seated or standing.", seconds: 12 },
      { text: "Feel your feet — on the floor if standing, or flat on the ground if seated. Press them down.", seconds: 14 },
      { text: "Notice the floor pressing back up. It's solid. It's holding you.", seconds: 12 },
      { text: "If standing, gently sway a little — forward and back, side to side — feeling how you stay balanced.", seconds: 16 },
      { text: "Come to stillness with your weight even across both feet. Strong and settled.", seconds: 14 },
      { text: "Press your palms together in front of your chest, firmly, and feel your own strength.", seconds: 14 },
      { text: "Release. Let your arms rest. Feel the steadiness that's still there.", seconds: 12 },
      { text: "You are grounded. Rooted. Here.", seconds: 12 },
    ],
  },
  {
    id: "gentle-stretch", type: "movement", title: "Easing tension",
    intro: "A few slow, simple stretches to release tension the day leaves in the neck, shoulders, and sides.",
    durationSec: 132, intensity: 1, tags: ["stretch", "release", "seated-option"], hasHold: false,
    note: "Move slowly and never past an easy, comfortable stretch. Everything here works seated if you prefer.",
    segments: [
      { text: "A few gentle stretches to release held tension. Move slowly, and never past an easy, comfortable stretch.", seconds: 14 },
      { text: "Reach both arms up overhead, as high as feels good, and lengthen through your sides.", seconds: 14 },
      { text: "Let your arms float back down. Roll your shoulders slowly backward a few times.", seconds: 16 },
      { text: "Now roll them forward a few times, feeling the joints loosen.", seconds: 14 },
      { text: "Gently drop your right ear toward your right shoulder. Hold for a soft breath or two.", seconds: 16 },
      { text: "Come back to center, and tilt your left ear toward your left shoulder. Easy and slow.", seconds: 16 },
      { text: "Return to center. Reach your right arm up and over into a gentle side bend.", seconds: 14 },
      { text: "Come back through center, and bend gently to the other side.", seconds: 14 },
      { text: "Return upright. Let your arms rest, and notice the openness you've made.", seconds: 14 },
    ],
  },
  {
    id: "shake-it-out", type: "movement", title: "Shaking it off",
    intro: "Animals tremble to discharge stress after a threat passes. This gently does the same — letting held tension rattle loose and leave.",
    durationSec: 126, intensity: 2, tags: ["discharge", "release", "activating"], hasHold: false,
    note: "Keep it light and stay in control — this isn't exercise. If shaking feels overwhelming or activating, slow down or stop and feel your feet instead.",
    segments: [
      { text: "Animals shake off stress after a threat passes — trembling to discharge it. We can do the same, gently.", seconds: 14 },
      { text: "Start with your hands. Let them go loose and shake them out, like flicking off water.", seconds: 14 },
      { text: "Let the shaking travel up into your wrists and forearms. Easy and loose.", seconds: 14 },
      { text: "If it feels okay, add your arms and shoulders. There's no right way — just let them move.", seconds: 14 },
      { text: "You might bounce gently at the knees, letting the whole body loosen and jiggle.", seconds: 14 },
      { text: "Keep it light. This isn't exercise — it's letting tension rattle loose and leave.", seconds: 14 },
      { text: "Now slow the movement down, little by little, until you come to stillness.", seconds: 14 },
      { text: "Stand or sit quietly. Notice any buzzing, warmth, or aliveness where you were shaking.", seconds: 16 },
      { text: "That's your body completing the stress cycle. Let it settle.", seconds: 12 },
    ],
  },
  {
    id: "push-and-press", type: "movement", title: "Strong and contained",
    intro: "Pushing against something steady can help a scattered system feel strong, gathered, and contained.",
    durationSec: 130, intensity: 2, tags: ["proprioceptive", "containment", "strengthening"], hasHold: false,
    note: "Press firmly but comfortably — never to strain. Skip the wall press if you'd rather stay seated; the palm press and self-hug work anywhere.",
    segments: [
      { text: "When we feel scattered, pushing against something steady can help us feel strong and contained.", seconds: 14 },
      { text: "Press your palms flat together in front of you and push, firmly but comfortably, for a few seconds.", seconds: 16 },
      { text: "Release. Notice the sensation in your arms and hands.", seconds: 12 },
      { text: "Now, if there's a wall nearby, place both palms on it and press, as if gently pushing it away.", seconds: 16 },
      { text: "Feel your feet root and your whole body engage. You are solid and strong.", seconds: 14 },
      { text: "Release, and shake your arms out lightly.", seconds: 12 },
      { text: "Finally, wrap your arms around yourself in a gentle hug, and give a light, steady squeeze.", seconds: 16 },
      { text: "Feel the containment of your own arms — the sense of being held, and holding yourself.", seconds: 16 },
      { text: "Release when you're ready. Notice you feel a little more gathered, a little more here.", seconds: 14 },
    ],
  },
];

const ALL_PRACTICES: Practice[] = [...BREATHWORK, ...MEDITATIONS, ...SLEEP, ...MOVEMENT];

/** Whether today's check-in indicates we should surface gentler, no-hold work
 *  first (roadmap §9 titration). Best-effort — defaults to false. */
async function shouldTitrate(userId: string): Promise<boolean> {
  const checkin = await getTodayCheckin(userId);
  if (!checkin) return false;
  const c = checkin as { dissociation?: number; activation?: number; recommended_action?: string };
  return (
    (c.dissociation ?? 0) >= 4 ||
    (c.activation ?? 0) >= 7 ||
    c.recommended_action === "grounding_only" ||
    c.recommended_action === "stabilization"
  );
}

/** List practices of a type, safety-ordered for the member's day. When today's
 *  check-in is elevated, no-hold / gentler (intensity 1) patterns come first. */
export async function listPractices(userId: string, type?: PracticeType): Promise<Practice[]> {
  const items = ALL_PRACTICES.filter((p) => !type || p.type === type);
  const titrate = await shouldTitrate(userId);
  return [...items].sort((a, b) => {
    if (titrate) {
      // Gentler day: no-hold before hold, then by intensity.
      if (a.hasHold !== b.hasHold) return a.hasHold ? 1 : -1;
    }
    return a.intensity - b.intensity;
  });
}

export function getPractice(id: string): Practice | undefined {
  return ALL_PRACTICES.find((p) => p.id === id);
}

/** Record a completed practice: a content-free row + audit, and a light
 *  companion-memory note so the daily plan / companion can reflect it. */
export async function recordPracticeCompletion(
  userId: string,
  practiceId: string,
  durationSec: number
): Promise<{ ok: boolean }> {
  const practice = getPractice(practiceId);
  if (!practice) return { ok: false };
  const secs = Math.max(0, Math.min(3600, Math.round(durationSec)));
  const c = await data();
  await c.run(
    "INSERT INTO practice_completions (id, user_id, practice_id, practice_type, duration_sec) VALUES (?, ?, ?, ?, ?)",
    [newId(), userId, practice.id, practice.type, secs]
  );
  await writeMemory({
    userId,
    type: "session_pattern",
    key: `regulated with ${practice.type}`,
    value: practice.title,
    source: "session_reflection",
  });
  await audit({
    actorId: userId, actorRole: "member", family: "clinical",
    type: "practice_completed", target: practice.id,
    detail: { type: practice.type, durationSec: secs },
  });
  // Dual-write to the longitudinal spine (ADR 0010 step 2). Shared by web and
  // mobile — both reach this function.
  await recordInterventionCompleted({
    userId, interventionId: practice.id, interventionType: practice.type, durationSec: secs,
  });
  return { ok: true };
}

/** Recent completion count (for streaks / "showed up" — roadmap F10/F12). */
export async function practiceCompletionCount(userId: string, sinceISO?: string): Promise<number> {
  const c = await data();
  const row = (await c.get(
    `SELECT COUNT(*) AS n FROM practice_completions WHERE user_id = ? ${sinceISO ? "AND created_at >= ?" : ""}`,
    sinceISO ? [userId, sinceISO] : [userId]
  )) as { n: number };
  return row?.n ?? 0;
}
