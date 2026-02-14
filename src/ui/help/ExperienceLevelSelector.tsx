import { Component } from "solid-js";

interface ExperienceLevelSelectorProps {
  level: string;
  onLevelChange: (level: string) => void;
}

export const ExperienceLevelSelector: Component<ExperienceLevelSelectorProps> = (props) => {
  return (
    <div id="userguide-dropdown">
      <label for="userguide-select">Experience level: </label>
      <select 
        id="userguide-select" 
        value={props.level} 
        onChange={(e) => props.onLevelChange(e.currentTarget.value)}
      >
        <option value="beginner">Beginner</option>
        <option value="advanced">Advanced</option>
      </select>
    </div>
  );
};
