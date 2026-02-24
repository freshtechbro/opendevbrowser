import roadmapData from "@/content/roadmap.json";

export type RoadmapMilestone = {
  milestone: string;
  window: string;
  goal: string;
  owner: string;
  status: string;
};

const data = roadmapData as { generatedAt: string; milestones: RoadmapMilestone[] };

export function getRoadmapMilestones(): RoadmapMilestone[] {
  return data.milestones;
}
