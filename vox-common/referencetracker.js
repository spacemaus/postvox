
/**
 * Tracks many-to-many references between targets and followers.
 */
exports.ReferenceTracker = function() {
  var self = {};

  /**
   * Map-of-maps. The first level is keyed by `target`, the second level by
   * `follower`.  The second-level value is `1`.
   */
  var targetToFollowers = {};

  /**
   * Map-of-maps. The first level is keyed by `follower`, the second level by
   * `target`.  The second-level value is `1`.
   */
  var followerToTargets = {};

  /**
   * Adds a follower for a given target.
   *
   * target (string): The name of the target.
   * follower (string): The follower to register.
   *
   * Returns true iff the target/follower pair is newly added.
   */
  self.Add = function(target, follower) {
    var followers = targetToFollowers[target];
    if (!followers) {
      followers = {};
      targetToFollowers[target] = followers;
    } else if (follower in followers) {
      return false;
    }
    followers[follower] = 1;
    var targets = followerToTargets[follower];
    if (!targets) {
      targets = {};
      followerToTargets[follower] = targets;
    }
    targets[target] = 1;
    return true;
  }

  /**
   * Removes a follower for a given target.
   *
   * Returns true iff the target has no remaining followers.
   */
  self.Remove = function(target, follower) {
    var followers = targetToFollowers[target];
    var hasAnyFollowers = false
    if (followers) {
      delete followers[follower];
      for (var _ in followers) {
        hasAnyFollowers = true;
        break;
      }
    }
    var targets = followerToTargets[follower];
    if (targets) {
      delete targets[target];
    }
    return !hasAnyFollowers;
  }

  /**
   * Removes all targets for the given follower.
   *
   * Returns a map of {target: bool} where the bool is true iff the target has
   * no remaining followers.
   */
  self.RemoveAll = function(follower) {
    var targets = followerToTargets[follower];
    if (!targets) {
      return;
    }
    var affectedTargets = {};
    for (var target in targets) {
      var followers = targetToFollowers[target];
      if (!followers) {
        continue;
      }
      delete followers[follower];
      var hasAnyFollowers = false;
      for (var _ in followers) {
        hasAnyFollowers = true;
        break;
      }
      affectedTargets[target] = !hasAnyFollowers;
    }
    return affectedTargets;
  }

  /**
   * Calls `fn(follower)` for every follower registered with the given targets.
   *
   * `fn(follower)` will be called only once for each unique follower.
   */
  self.ForEachFollower = function(targets, fn) {
    var seen = {};
    targets.forEach(function(target) {
      var followers = targetToFollowers[target];
      if (!followers) {
        return;
      }
      for (var follower in followers) {
        if (follower in seen) {
          continue;
        }
        seen[follower] = 1;
        fn(follower);
      }
    });
  }

  return self;
}
