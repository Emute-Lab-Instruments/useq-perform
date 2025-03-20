
export function initThemePanel() {
    
    // Button
    $("#themeButton").on("click", async () => {
    
        $("#theme-panel").toggle('active');
        // const editorConfig = getUserSettings('editor');
        // editorConfig.theme = (editorConfig.theme + 1) % themes.length;
        // changeTheme(editor, editorConfig.theme);
        // updateUserSettings('editor', { theme: editorConfig.theme });
      });
}