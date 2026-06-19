import type { JSX } from 'react';

import type { PipelineRoleOutputHistoryItem } from '../chatTypes';
import { MarkdownDisplay } from './MarkdownDisplay';

export interface PipelineRoleOutputBlockProps {
  item: PipelineRoleOutputHistoryItem;
}

export function PipelineRoleOutputBlock({ item }: PipelineRoleOutputBlockProps): JSX.Element {
  return (
    <div className="pipeline-role-output">
      <div className="pipeline-role-output-header">{item.title}</div>
      <MarkdownDisplay>{item.text}</MarkdownDisplay>
    </div>
  );
}
