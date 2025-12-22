#!/usr/bin/env bash

# Configuration
EPIC_ID="protocol"
SUBTASKS=("biy" "c55" "gr4")
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKTREE_BASE="$(dirname "$PROJECT_ROOT")/$(basename "$PROJECT_ROOT")-worktrees"
MODEL="gemini-3-flash-preview"
MAX_PARALLEL=${#SUBTASKS[@]}

# Help message
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo "Options:"
    echo "  -n NUMBER    Only spawn this many workers in parallel (default: all)"
    echo "  --merge      Merge worktree branches back into current branch"
    echo "  --cleanup    Clean up all worktrees and temporary branches"
    echo "  --help       Show this help message"
}

# Cleanup function
cleanup() {
    echo "Cleaning up worktrees..."
    for task in "${SUBTASKS[@]}"; do
        task_id="${EPIC_ID}.${task}"
        branch_name="migrate-${task_id}"
        worktree_path="${WORKTREE_BASE}/${branch_name}"

        if [ -d "$worktree_path" ]; then
            git worktree remove -f "$worktree_path"
        fi
        git branch -D "$branch_name" 2>/dev/null
    done
    rm -rf "$WORKTREE_BASE"
    echo "Cleanup complete."
}

# Merge function
merge_worktrees() {
    echo "Merging worktree branches..."
    for task in "${SUBTASKS[@]}"; do
        task_id="${EPIC_ID}.${task}"
        branch_name="migrate-${task_id}"
        worktree_path="${WORKTREE_BASE}/${branch_name}"
        
        if ! git show-ref --verify --quiet "refs/heads/$branch_name"; then
            echo "Branch $branch_name does not exist. Skipping."
            continue
        fi

        echo "Merging $branch_name..."
        if git merge "$branch_name" --no-edit; then
            echo "Successfully merged $branch_name."
        else
            echo "Conflict in $branch_name. Spawning merger agent..."
            # Gather reports if they exist
            reports=""
            if [ -f "$worktree_path/REPORT.md" ]; then
                reports="Report from $task_id:\n$(cat $worktree_path/REPORT.md)\n\n"
            fi
            
            gemini --approval-mode yolo -m "$MODEL" "You are an expert developer tasked with merging branch $branch_name into the current branch and resolving any conflicts. 
            
            Context from subtask reports:
            $reports
            
            Please resolve the conflicts, ensure the code builds and tests pass, and commit the resolution."
        fi
    done
    echo "Merge complete."
}

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -n) MAX_PARALLEL="$2"; shift ;;
        --merge) merge_worktrees; exit 0 ;;
        --cleanup) cleanup; exit 0 ;;
        --help) show_help; exit 0 ;;
        *) echo "Unknown parameter: $1"; show_help; exit 1 ;;
    esac
    shift
done

if [[ "$MAX_PARALLEL" -le 0 ]]; then
    echo "No workers to spawn (n=$MAX_PARALLEL)."
    exit 0
fi

mkdir -p "$WORKTREE_BASE"

running_jobs=0
for task in "${SUBTASKS[@]}"; do
    task_id="${EPIC_ID}.${task}"
    branch_name="migrate-${task_id}"
    worktree_path="${WORKTREE_BASE}/${branch_name}"

    # Check status with bd
    status=$(bd --no-db list --json | jq -r ".[] | select(.id == \"$task_id\") | .status")
    
    if [[ "$status" == "closed" || "$status" == "resolved" ]]; then
        echo "Subtask $task_id is already $status. Skipping."
        continue
    fi

    # Wait for a slot if we reached the limit
    while (( running_jobs >= MAX_PARALLEL )); do
        wait -n
        ((running_jobs--))
    done

    # Create worktree if it doesn't exist
    if [ ! -d "$worktree_path" ]; then
        echo "Creating worktree for $task_id..."
        git worktree add -b "$branch_name" "$worktree_path"
    else
        echo "Reusing worktree for $task_id..."
    fi

    # Fetch full description
    description=$(bd --no-db list --json | jq -r ".[] | select(.id == \"$task_id\") | .description")
    
    echo "Starting agent for $task_id..."
    (
        cd "$worktree_path"
        # Mark as in_progress
        bd --no-db update "$task_id" --status in_progress --json > /dev/null 2>&1
        
        log_file="agent.log"
        if gemini --approval-mode yolo -m "$MODEL" "You are an expert developer. Your task is to implement subtask $task_id:
        
        $description
        
        Refer to the project's migration guide (MIGRATION_README.md) and existing SolidJS/XState/Effect patterns.
        When finished:
        1. Write a comprehensive report in REPORT.md explaining:
           - What you implemented and why.
           - Any assumptions or decisions made.
           - Any challenges encountered.
        2. Mark the task as closed using 'bd --no-db close $task_id --reason \"Completed\"'.
        3. Ensure all changes including REPORT.md and the updated .beads/issues.jsonl are committed in the worktree branch.
        
        Follow the project's coding standards and run tests if applicable." > "$log_file" 2>&1; then
            echo "Agent for $task_id completed successfully."
        else
            exit_code=$?
            if grep -qiE "rate limit|quota|429|too many requests" "$log_file"; then
                echo "Agent for $task_id failed due to RATE LIMIT or QUOTA issues (Exit: $exit_code)."
                # Revert status to todo so it can be retried
                bd --no-db update "$task_id" --status todo --json > /dev/null 2>&1
            else
                echo "Agent for $task_id failed (Exit: $exit_code). See $worktree_path/$log_file"
            fi
        fi
    ) &
    ((running_jobs++))

    # Stagger starts to avoid burst rate limits
    sleep 2
done

wait
echo "All parallel agents have finished. Run with --merge to integrate changes."
