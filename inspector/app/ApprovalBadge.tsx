import { isApproved } from '../framework/approvals';

interface ApprovalBadgeProps {
  scenarioId: string;
}

export default function ApprovalBadge(props: ApprovalBadgeProps) {
  return (
    <span
      class="approval-badge"
      classList={{ 'approval-badge-approved': isApproved(props.scenarioId) }}
      title={isApproved(props.scenarioId) ? 'Approved' : 'Unreviewed'}
    />
  );
}
