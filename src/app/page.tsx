import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MyMultisigs } from "@/components/my-multisigs";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-[60vh]">
      <div className="max-w-2xl w-full space-y-8 px-4">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Aptos Multisig</h1>
          <p className="text-muted-foreground">
            Create and manage multi-signature wallets on Aptos. Require multiple
            approvals before executing transactions for enhanced security.
          </p>
        </div>

        <MyMultisigs />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Create New</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Set up a new multisig wallet with your co-signers and choose a
                signing threshold.
              </p>
              <Link
                href="/multisig/create"
                className={cn(buttonVariants({ variant: "default" }), "w-full")}
              >
                Create Multisig
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Import Existing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Import an existing multisig wallet by providing the public keys
                and threshold.
              </p>
              <Link
                href="/multisig/import"
                className={cn(buttonVariants({ variant: "outline" }), "w-full")}
              >
                Import Multisig
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
