import { Component, Show } from "solid-js";
import { sanitizeHtml } from "../../utils/sanitize";

interface UserGuideContentProps {
  content?: string;
  loading: boolean;
  error: any;
}

export const UserGuideContent: Component<UserGuideContentProps> = (props) => {
  return (
    <div id="userguide-content">
      <Show when={!props.loading} fallback={<div>Loading user guide...</div>}>
        <div innerHTML={sanitizeHtml(props.content ?? "")} />
      </Show>
      <Show when={props.error}>
        <p>Error loading user guide. Please try refreshing the page.</p>
      </Show>
    </div>
  );
};
