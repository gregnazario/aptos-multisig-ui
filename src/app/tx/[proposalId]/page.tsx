import { ProposalView } from "@/components/proposal-view";

interface Props {
  params: Promise<{ proposalId: string }>;
}

export default async function ProposalPage({ params }: Props) {
  const { proposalId } = await params;
  return <ProposalView proposalId={proposalId} />;
}
