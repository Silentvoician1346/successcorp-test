"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";

export default function SignOutSubmitButton() {
  const clearEmail = useAuthStore((state) => state.clearEmail);

  return (
    <Button
      type="submit"
      variant="ghost"
      className="bg-transparent text-white hover:bg-transparent hover:text-white"
      onClick={() => clearEmail()}
    >
      <LogOut aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}
