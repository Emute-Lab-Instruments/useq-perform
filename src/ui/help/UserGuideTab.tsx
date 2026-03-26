import { Component, createSignal, createResource } from "solid-js";
import { ExperienceLevelSelector } from "./ExperienceLevelSelector";
import { UserGuideContent } from "./UserGuideContent";
import { loadRaw, saveRaw, PERSISTENCE_KEYS } from "../../lib/persistence.ts";
import { getCachedGuide } from "../../lib/helpContentPreloader.ts";

export const UserGuideTab: Component = () => {
  const [experienceLevel, setExperienceLevel] = createSignal(
    loadRaw(PERSISTENCE_KEYS.experienceLevel, "beginner")
  );

  const fetchGuide = async (level: string) => {
    const cached = getCachedGuide(level);
    if (cached) return cached;
    const response = await fetch(`assets/userguide_${level}.html`);
    if (!response.ok) throw new Error("Failed to load user guide");
    return await response.text();
  };

  const [guideContent] = createResource(experienceLevel, fetchGuide);

  const handleLevelChange = (level: string) => {
    setExperienceLevel(level);
    saveRaw(PERSISTENCE_KEYS.experienceLevel, level);
  };

  return (
    <div id="userguide-container">
      <ExperienceLevelSelector 
        level={experienceLevel()} 
        onLevelChange={handleLevelChange} 
      />
      <UserGuideContent 
        content={guideContent()} 
        loading={guideContent.loading} 
        error={guideContent.error} 
      />
    </div>
  );
};