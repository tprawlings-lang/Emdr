"use client";
import { useEffect } from "react";
import { markLessonReadAction } from "@/lib/actions";

// Marks a lesson read once, when its reader page opens. Best-effort.
export default function MarkLessonRead({ lessonId }: { lessonId: string }) {
  useEffect(() => {
    void markLessonReadAction(lessonId);
  }, [lessonId]);
  return null;
}
