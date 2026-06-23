import type { JSX } from 'react';

import type { PipelineRoleOutputItem } from '../app/OrchestrationProjector';
import { MarkdownDisplay } from './MarkdownDisplay';

export interface PipelineRoleOutputBlockProps {
  item: PipelineRoleOutputItem;
}

export function PipelineRoleOutputBlock({ item }: PipelineRoleOutputBlockProps): JSX.Element {
  return (
    <div className="pipeline-role-output">
      <div className="pipeline-role-output-header">{item.title}</div>
      <MarkdownDisplay>{item.text}</MarkdownDisplay>
    </div>
  );
}
