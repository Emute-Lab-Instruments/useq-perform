import { Component, createSignal, createResource, Show } from "solid-js";

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
      <div id="userguide-dropdown">
        <label for="userguide-select">Experience level: </label>
        <select 
          id="userguide-select" 
          value={experienceLevel()} 
          onChange={(e) => handleLevelChange(e.currentTarget.value)}
        >
          <option value="beginner">Beginner</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>
      <div id="userguide-content">
        <Show when={!guideContent.loading} fallback={<div>Loading user guide...</div>}>
          <div innerHTML={guideContent()} />
        </Show>
        <Show when={guideContent.error}>
          <p>Error loading user guide. Please try refreshing the page.</p>
        </Show>
      </div>
    </div>
  );
};