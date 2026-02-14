import { Component, createSignal, createResource } from "solid-js";
import { ExperienceLevelSelector } from "./ExperienceLevelSelector";
import { UserGuideContent } from "./UserGuideContent";

export const UserGuideTab: Component = () => {
  const [experienceLevel, setExperienceLevel] = createSignal(
    localStorage.getItem("useqExperienceLevel") || "beginner"
  );

  const fetchGuide = async (level: string) => {
    const response = await fetch(`assets/userguide_${level}.html`);
    if (!response.ok) throw new Error("Failed to load user guide");
    return await response.text();
  };

  const [guideContent] = createResource(experienceLevel, fetchGuide);

  const handleLevelChange = (level: string) => {
    setExperienceLevel(level);
    localStorage.setItem("useqExperienceLevel", level);
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