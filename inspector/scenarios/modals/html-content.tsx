import { defineScenario } from '../../framework/scenario';
import { Modal } from '@src/ui/Modal';

export default defineScenario({
  category: 'Modals & Overlays / Modal',
  name: 'HTML content modal (real)',
  type: 'contract',
  sourceFiles: ['src/ui/Modal.tsx'],
  description:
    'Real Modal component displaying rich HTML content including paragraphs, styled text, lists, and links.',
  component: {
    render: () => (
      <Modal title="Release Notes" onClose={() => {}}>
        <div style={{ "font-size": "0.85rem", "line-height": "1.6" }}>
          <p>
            New in <strong>v1.2.0</strong>:
          </p>
          <ul style={{ "padding-left": "1.25rem", margin: "0.5rem 0" }}>
            <li>
              Improved <em>inline evaluation</em> rendering
            </li>
            <li>
              Added{" "}
              <a href="#" style={{ color: "#7aa2f7", "text-decoration": "underline" }} onClick={(e) => e.preventDefault()}>
                diagnostic hints
              </a>{" "}
              with squiggly underlines
            </li>
            <li>Fixed serialisation edge cases</li>
            <li>
              New <code style={{ background: "rgba(255,255,255,0.08)", padding: "2px 4px", "border-radius": "3px" }}>
                gamepad radial menu
              </code>{" "}
              for expression insertion
            </li>
          </ul>
          <p style={{ "margin-top": "0.75rem" }}>
            See the{" "}
            <a href="#" style={{ color: "#7aa2f7", "text-decoration": "underline" }} onClick={(e) => e.preventDefault()}>
              full changelog
            </a>{" "}
            for details.
          </p>
          <p style={{ "margin-top": "0.5rem", color: "#808098", "font-size": "0.8rem" }}>
            Thank you for using uSEQ Perform.
          </p>
        </div>
      </Modal>
    ),
    loadAppStyles: true,
    width: 500,
    height: 400,
  },
});
