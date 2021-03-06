/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import * as chai from 'chai';
import * as moment from 'moment';
import {
  approve,
  defer,
  getIsDoneScoring,
  highlight,
  reject,
  scoresComplete,
  setCommentState,
} from '../../../domain/comments/state';
import {
  CommentScoreRequest,
  Decision,
  ICommentInstance,
} from '../../../models';
import {
  createArticle,
  createComment,
  createCommentScoreRequest,
  createServiceUser,
  createUser,
} from './fixture';

// tslint:disable no-import-side-effect
import '../../test_helper';
// tslint:enable no-import-side-effect

const assert = chai.assert;

async function shouldRecordDecision(comment: ICommentInstance, status: string, source: string, userId: number) {
  const foundDecisions = await Decision.findAll({
    where: {
      commentId: comment.get('id'),
    },
  });

  assert.lengthOf(foundDecisions, 1);

  const firstDecision = foundDecisions[0];

  assert.equal(firstDecision.get('commentId'), comment.get('id'));
  assert.equal(firstDecision.get('userId'), userId);
  assert.equal(firstDecision.get('source'), source);
  assert.equal(firstDecision.get('status'), status);
  assert.isTrue(firstDecision.get('isCurrentDecision'));
}

describe('Comments Domain States Tests', () => {
  let comment: any;
  let article;

  beforeEach(async () => {
    article = await createArticle();
    comment = await createComment({ articleId: article.get('id') });
  });

  describe('scoresComplete', () => {
    it('should return false for no score requests', () => {
      assert.isFalse(scoresComplete([]));
    });

    it('should return false with score requests that dont have a `doneAt` value set', () => {
      const scoreRequests = [
        CommentScoreRequest.build({
          commentId: 1,
          userId: 1,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: null,
        }),
      ];

      assert.isFalse(scoresComplete(scoreRequests));
    });

    it('should return false with a mix of `doneAt` settings', () => {
      const scoreRequests = [
        CommentScoreRequest.build({
          commentId: 1,
          userId: 1,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: moment().toDate(),
        }),

        CommentScoreRequest.build({
          commentId: 1,
          userId: 2,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: null,
        }),
      ];

      assert.isFalse(scoresComplete(scoreRequests));
    });

    it('should return true when all score requests have `doneAt` value set', () => {
      const scoreRequests = [
        CommentScoreRequest.build({
          commentId: 1,
          userId: 1,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: moment().toDate(),
        }),

        CommentScoreRequest.build({
          commentId: 1,
          userId: 2,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: moment().toDate(),
        }),
      ];

      assert.isTrue(scoresComplete(scoreRequests));
    });

    it('should return true when a scorer has repeat request and the latter has a `doneAt` set', () => {
      const scoreRequests = [
        CommentScoreRequest.build({
          commentId: 1,
          userId: 1,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: null,
        }),

        CommentScoreRequest.build({
          commentId: 1,
          userId: 1,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: moment().toDate(),
        }),

        CommentScoreRequest.build({
          commentId: 1,
          userId: 2,
          sentAt: moment().subtract(2, 'weeks').toDate(),
          doneAt: moment().toDate(),
        }),
      ];

      assert.isTrue(scoresComplete(scoreRequests));
    });
  });

  describe('getIsDoneScoring', () => {
    it('should resolve to true if all score requests have a `doneAt` timestamp set', async () => {
      const [scorer1, scorer2] = await Promise.all([
        createServiceUser(),
        createServiceUser(),
      ]);

      await Promise.all([
        createCommentScoreRequest({
          commentId: comment.get('id'),
          userId: scorer1.get('id'),
          doneAt: moment().toDate(),
        }),
        createCommentScoreRequest({
          commentId: comment.get('id'),
          userId: scorer2.get('id'),
          doneAt: moment().toDate(),
        }),
      ]);

      const isDoneScoring = await getIsDoneScoring(comment);
      assert.isTrue(isDoneScoring);
    });

    it('should resolve to false if unique scorer requests dont have a `doneAt` timestamp set', async () => {

      const [scorer1, scorer2] = await Promise.all([
        createServiceUser(),
        createServiceUser(),
      ]);

      await Promise.all([
        createCommentScoreRequest({
          commentId: comment.get('id'),
          userId: scorer1.get('id'),
          doneAt: moment().toDate(),
        }),
        createCommentScoreRequest({
          commentId: comment.get('id'),
          userId: scorer2.get('id'),
        }),
      ]);

      const isDoneScoring = await getIsDoneScoring(comment);
      assert.isFalse(isDoneScoring);
    });

    it(
      'should resolve to true if all requests have `doneAt` and at least one of multiple requests to a scorer is set',
      async () => {

        const [scorer1, scorer2] = await Promise.all([
          createServiceUser(),
          createServiceUser(),
        ]);

        await Promise.all([
          createCommentScoreRequest({
            commentId: comment.get('id'),
            userId: scorer1.get('id'),
          }),
          createCommentScoreRequest({
            commentId: comment.get('id'),
            userId: scorer1.get('id'),
            doneAt: moment().toDate(),
          }),
          createCommentScoreRequest({
            commentId: comment.get('id'),
            userId: scorer2.get('id'),
            doneAt: moment().toDate(),
          }),
        ]);

        const isDoneScoring = await getIsDoneScoring(comment);
        assert.isTrue(isDoneScoring);
      },
    );
  });

  describe('setCommentState', () => {
    it('should set the passed in state on the comment', async () => {
      const updated = await setCommentState(comment, { isAccepted: true });

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isTrue(updated.get('isAccepted'));
    });

    it('should include optional data and exclude conflicting keys with state', async () => {
      const updated = await setCommentState(
        comment,
        { isHighlighted: true },
        { isHighlighted: false, isBatchResolved: true },
      );

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isTrue(updated.get('isHighlighted'));
      assert.isTrue(updated.get('isBatchResolved'));
    });
  });

  describe('approve', () => {
    it('should set the passed in comment to a "approved" state and save it', async () => {
      const user = await createUser();
      const updated = await approve(comment, user, false);

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isTrue(updated.get('isAccepted'));
      assert.isFalse(updated.get('isDeferred'));

      await shouldRecordDecision(updated, 'Accept', 'User', user.get('id'));
    });

    it('should optionally accept additional data', async () => {
      const user = await createUser();
      const updated = await approve(comment, user, false);

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isTrue(updated.get('isAccepted'));
      assert.isFalse(updated.get('isDeferred'));

      await shouldRecordDecision(updated, 'Accept', 'User', user.get('id'));
    });
  });

  describe('reject', () => {
    it('should set the passed in comment to a "rejected" state and save it', async () => {
      const user = await createUser();
      const updated = await reject(comment, user, false);

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isFalse(updated.get('isAccepted'));
      assert.isFalse(updated.get('isDeferred'));

      await shouldRecordDecision(updated, 'Reject', 'User', user.get('id'));
    });
  });

  describe('defer', () => {
    it('should set the passed in comment to a "defered" state and save it', async () => {
      const user = await createUser();
      const updated = await defer(comment, user, false);

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isNull(updated.get('isAccepted'));
      assert.isTrue(updated.get('isDeferred'));

      await shouldRecordDecision(updated, 'Defer', 'User', user.get('id'));
    });
  });

  describe('highlight', () => {
    it('should set the passed in comment to a "highlighted" state and save it', async () => {
      const user = await createUser();
      const updated = await highlight(comment, user);

      assert.equal(comment.get('id'), updated.get('id'));
      assert.isTrue(updated.get('isHighlighted'));
    });
  });
});
