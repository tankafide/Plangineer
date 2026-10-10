import { zodResolver } from '@hookform/resolvers/zod';
import { useAnswerQuestion } from '@plangineer/api-client';
import { PlanAnswerInput, type PlanQuestion } from '@plangineer/contracts';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { PlanActionError } from './plan-action-error';
import { SECTION_LABELS } from './plan-labels';

/** The engineer's own answer. The output keeps the contract's rule for it. */
const AnswerFields = z
  .object({ text: z.string().trim().min(1, 'Write an answer, or pick a choice.') })
  .pipe(z.object({ text: PlanAnswerInput.shape.text.unwrap() }));
type AnswerInput = z.input<typeof AnswerFields>;
type AnswerOutput = z.output<typeof AnswerFields>;

/** The choices with the recommended one first, each keeping its index in the question. */
function choicesInOrder(question: PlanQuestion) {
  const indexed = question.choices.map((choice, index) => ({ ...choice, index }));
  return indexed.toSorted(
    (a, b) => Number(b.index === question.recommended) - Number(a.index === question.recommended),
  );
}

function OpenQuestion({
  question,
  position,
  total,
}: {
  question: PlanQuestion;
  position: number;
  total: number;
}) {
  const answer = useAnswerQuestion();
  const form = useForm<AnswerInput, unknown, AnswerOutput>({
    resolver: zodResolver(AnswerFields),
    defaultValues: { text: '' },
  });
  const submit = form.handleSubmit(({ text }) => answer.mutate({ questionId: question.id, text }));

  return (
    <Card>
      <CardHeader>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span>{`Question ${position} of ${total}`}</span>
          <Badge variant="outline">{SECTION_LABELS[question.section]}</Badge>
        </CardDescription>
        <CardTitle>
          <h2 className="text-base font-semibold break-words whitespace-pre-wrap">
            {question.prompt}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul aria-label="Choices" className="flex flex-col gap-2">
          {choicesInOrder(question).map((choice) => (
            <li key={choice.index}>
              <Button
                variant="outline"
                className="h-auto min-h-11 w-full flex-col items-start gap-1 py-2 text-left whitespace-normal md:h-auto"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ questionId: question.id, choice: choice.index })}
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {choice.label}
                  {choice.index === question.recommended && (
                    <Badge variant="info">Recommended</Badge>
                  )}
                </span>
                {choice.detail !== '' && (
                  <span className="font-normal text-muted-foreground">{choice.detail}</span>
                )}
              </Button>
            </li>
          ))}
        </ul>
        <form noValidate className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <Controller
            control={form.control}
            name="text"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="question-answer">Your answer</FieldLabel>
                <Textarea
                  {...field}
                  id="question-answer"
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? 'question-answer-error' : undefined}
                />
                <FieldError id="question-answer-error" errors={[fieldState.error]} />
              </Field>
            )}
          />
          {answer.isError && (
            <PlanActionError error={answer.error} onRetry={() => answer.mutate(answer.variables)} />
          )}
          <Button
            type="submit"
            variant="outline"
            className="w-full md:w-auto md:self-start"
            disabled={answer.isPending}
          >
            Answer
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** The first open question of the agent's latest questions, one at a time. */
export function QuestionCard({ questions }: { questions: readonly PlanQuestion[] }) {
  const open = questions.findIndex((question) => question.answeredAt === null);
  const question = questions[open];
  if (question === undefined) return null;
  // A new question starts with an empty answer.
  return (
    <OpenQuestion
      key={question.id}
      question={question}
      position={open + 1}
      total={questions.length}
    />
  );
}
