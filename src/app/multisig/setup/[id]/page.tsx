import { SetupVerifier } from "@/components/setup-verifier";

export default async function SetupVerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="max-w-2xl mx-auto">
      <SetupVerifier setupId={id} />
    </div>
  );
}
