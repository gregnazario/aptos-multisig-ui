import { SetupVerifier } from "@/components/setup-verifier";

export default async function SetupVerificationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <SetupVerifier setupId={id} />
    </div>
  );
}
