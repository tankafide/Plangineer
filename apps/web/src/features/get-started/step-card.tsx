import { Circle, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** One get-started step: whether it is done, its title, one line of text and its buttons. */
export function StepCard({
  title,
  done,
  children,
}: {
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {done ? (
            <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
          ) : (
            <Circle aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          )}
          <h2 className="min-w-0">{title}</h2>
          <span className="sr-only">{done ? 'Done' : 'Not done'}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}
