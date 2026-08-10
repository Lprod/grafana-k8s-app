import React from 'react';
import { EmbeddedScene, SceneFlexItem, SceneFlexLayout, SceneReactObject } from '@grafana/scenes';
import { Alert } from '@grafana/ui';

export function getComingSoonScene(message: string) {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          ySizing: 'content',
          body: new SceneReactObject({
            reactNode: (
              <Alert severity="info" title="Coming soon">
                {message}
              </Alert>
            ),
          }),
        }),
      ],
    }),
  });
}
