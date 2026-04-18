import * as React from "react";

import { cn } from "@/lib/utils";

type FormProps = React.FormHTMLAttributes<HTMLFormElement>;

export function Form({ className, ...props }: FormProps) {
  return <form className={cn("form-root space-y-4", className)} {...props} />;
}

type FormFieldProps = {
  children: React.ReactNode;
  className?: string;
};

export function FormField({ children, className }: FormFieldProps) {
  return <div className={cn("form-field space-y-1.5", className)}>{children}</div>;
}

type FormLabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  optional?: boolean;
};

export function FormLabel({ children, optional, className, ...props }: FormLabelProps) {
  return (
    <label className={cn("form-label text-[0.82rem] font-semibold", className)} {...props}>
      {children}
      {optional ? (
        <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">optional</span>
      ) : null}
    </label>
  );
}

type FormErrorProps = {
  children: React.ReactNode;
  className?: string;
};

export function FormError({ children, className }: FormErrorProps) {
  return (
    <p
      role="alert"
      className={cn(
        "form-error rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
        className
      )}
    >
      {children}
    </p>
  );
}

type FormActionsProps = {
  children: React.ReactNode;
  className?: string;
};

export function FormActions({ children, className }: FormActionsProps) {
  return <div className={cn("form-actions flex items-center gap-2 pt-1", className)}>{children}</div>;
}
