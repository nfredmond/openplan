"""Compare JSON receipt values without Python's boolean/number equivalence."""
import math


def same_json_value(left, right) -> bool:
    """Keep JSON kinds distinct while allowing equal finite JSON numbers."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if left is None or right is None:
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        if any(isinstance(value, float) and not math.isfinite(value) for value in (left, right)):
            return False
        return left == right
    if isinstance(left, str) and isinstance(right, str):
        return left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return (all(isinstance(key, str) for key in (*left, *right))
                and left.keys() == right.keys()
                and all(same_json_value(left[key], right[key]) for key in left))
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(same_json_value(a, b) for a, b in zip(left, right))
    return False
